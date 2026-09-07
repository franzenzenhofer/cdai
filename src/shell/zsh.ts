import { dataDir } from '../paths.js';
import { EXIT } from '../protocol.js';
import {
  CLI_CONTROL_PATTERN,
  CLI_CONTROL_WORDS,
  ZSH_CD_FLAG_CHARS,
} from './control.js';
import { shellQuote } from './quote.js';

const recorder = (): string => `__cdai_record() {
  local previous_umask="$(umask)"
  umask 077
  print -r -- "\${EPOCHSECONDS}"$'\\t'"\${PWD}" >> "$_CDAI_DATA/visits.log" 2>/dev/null
  umask "$previous_umask"
}
add-zsh-hook chpwd __cdai_record`;

const runner = (): string => `__cdai_run() {
  command \${=CDAI_BIN:-cdai} "$@"
}`;

const parser = (): string => `__cdai_parse() {
  typeset -ga _CDAI_CD_FLAGS _CDAI_QUERY
  _CDAI_CD_FLAGS=()
  _CDAI_QUERY=()
  local arg parsing=1 literal=0
  for arg in "$@"; do
    if (( parsing )) && [[ "$arg" == -- ]]; then
      parsing=0
      literal=1
    elif (( parsing )) && [[ "$arg" =~ ^-[${ZSH_CD_FLAG_CHARS}]+$ ]]; then
      _CDAI_CD_FLAGS+=("$arg")
    elif (( ! literal )) && [[ "$arg" == [-+]* ]]; then
      return 1
    else
      parsing=0
      _CDAI_QUERY+=("$arg")
    fi
  done
}`;

/**
 * zsh prefixes the message with the failing function, and adds a line number whenever that
 * function came from an eval - which is exactly how the integration is loaded. Both shapes are
 * removed, so the user reads "cdai: cd: no such file or directory: ./x" and nothing internal.
 */
const nativeError = (): string => `__cdai_native_error() {
  local output result_status
  output="$(builtin cd "$@" 2>&1)"
  result_status=$?
  output="\${output#*:cd:<->: }"
  output="\${output#*:cd: }"
  [[ -n "$output" ]] && print -u2 -- "cdai: cd: $output"
  return $result_status
}`;

/** Words the executable owns, plus the local directory that may happen to share their name. */
const controls = (): string => `  if (( $# > 0 )) && [[ "$1" == (--help|-h|--version|-v) ]]; then
    __cdai_run "$@"
    return $?
  fi
  if (( $# > 0 )) && [[ "$1" == (${CLI_CONTROL_PATTERN}) ]]; then
    if (( $# == 1 )); then
      builtin cd "$1" 2>/dev/null && return
    fi
    __cdai_run "$@"
    return $?
  fi`;

/**
 * Native `cd` first, then every tier cdai has, and only then the builtin's own complaint: a path
 * cd cannot take may still be a place this machine knows, and exit ${EXIT.native} says nobody knew it.
 */
const jumper = (): string => `cdai() {
${controls()}
  builtin cd "$@" 2>/dev/null && return
  if ! __cdai_parse "$@"; then
    __cdai_native_error "$@"
    return $?
  fi
  if (( \${#_CDAI_QUERY} == 0 )); then
    __cdai_native_error "$@"
    return $?
  fi
  local result result_status
  result="$(__cdai_run query -- "\${_CDAI_QUERY[@]}")"
  result_status=$?
  if (( result_status == ${EXIT.native} )); then
    __cdai_native_error "$@"
    return $?
  fi
  (( result_status != 0 )) && return $result_status
  [[ -n "$result" ]] && builtin cd "\${_CDAI_CD_FLAGS[@]}" -- "$result"
}`;

const completer = (): string => `__cdai_complete() {
  local service=cd
  local -a indexed
  if (( CURRENT > 2 )); then
    case "\${words[2]}" in
      setup) _values 'setup option' --yes --ai --no-ai '--root[path]:directory:_directories' '--remove-root[path]:directory:_directories' '--depth[depth]:depth:' --help; return ;;
      index) _values 'index option' --refresh --help; return ;;
      alias) _values 'alias command' list add forget --help; return ;;
      init) _values 'shell' zsh bash fish --help; return ;;
      import) _values 'source' zoxide --help; return ;;
      doctor) _values 'doctor option' --help; return ;;
    esac
  fi
  _cd
  (( CURRENT == 2 )) && compadd -- ${CLI_CONTROL_WORDS}
  if __cdai_parse "\${words[@]:1}"; then
    indexed=("\${(@f)$(__cdai_run complete -- "\${_CDAI_QUERY[@]}" 2>/dev/null)}")
  fi
  indexed=("\${(@)indexed:#}")
  (( \${#indexed} > 0 )) && compadd -U -- "\${indexed[@]}"
}

if [[ -o interactive ]]; then
  autoload -Uz compinit
  (( $+functions[compdef] )) || compinit -i
  autoload -Uz _cd
  compdef __cdai_complete cdai
fi`;

/**
 * Emitted by `cdai init zsh` and consumed via eval. Recording is pure zsh builtins so the
 * prompt never pays for a subprocess; the binary ingests visits.log on the next navigation query.
 */
export const zshInit = (): string => `# cdai shell integration (zsh)
zmodload zsh/datetime 2>/dev/null
autoload -Uz add-zsh-hook
: \${CDAI_DATA_DIR:=${shellQuote(dataDir())}}
typeset -g _CDAI_DATA=\${CDAI_DATA_DIR}
[[ -d "$_CDAI_DATA" ]] || mkdir -p "$_CDAI_DATA"
chmod 700 "$_CDAI_DATA" 2>/dev/null || true

${recorder()}

${runner()}

${parser()}

${nativeError()}

${jumper()}

${completer()}
`;
