import { dataDir } from '../paths.js';
import { CLI_CONTROL_PATTERN, CLI_CONTROL_WORDS, ZSH_CD_FLAG_CHARS } from './control.js';
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

const explicit = (): string => `__cdai_explicit() {
  local arg
  for arg in "\${_CDAI_QUERY[@]}"; do
    [[ "$arg" == */* || "$arg" == '~'* ]] && return 0
  done
  return 1
}`;

const nativeError = (): string => `__cdai_native_error() {
  local output result_status
  output="$(builtin cd "$@" 2>&1)"
  result_status=$?
  output="\${output#*:cd: }"
  [[ -n "$output" ]] && print -u2 -- "cdai: cd: $output"
  return $result_status
}`;

const jumper = (): string => `cdai() {
  if (( $# > 0 )) && [[ "$1" == (--help|-h|--version|-v) ]]; then
    __cdai_run "$@"
    return $?
  fi
  if (( $# > 0 )) && [[ "$1" == (${CLI_CONTROL_PATTERN}) ]]; then
    if (( $# == 1 )); then
      builtin cd "$1" 2>/dev/null && return
    fi
    __cdai_run "$@"
    return $?
  fi
  builtin cd "$@" 2>/dev/null && return
  if ! __cdai_parse "$@"; then
    __cdai_native_error "$@"
    return $?
  fi
  if (( \${#_CDAI_QUERY} == 0 )) || __cdai_explicit; then
    __cdai_native_error "$@"
    return $?
  fi
  local result
  result="$(__cdai_run query -- "\${_CDAI_QUERY[@]}")" || return $?
  [[ -n "$result" ]] && builtin cd "\${_CDAI_CD_FLAGS[@]}" -- "$result"
}`;

const completer = (): string => `__cdai_complete() {
  local service=cd
  local -a indexed
  if (( CURRENT > 2 )); then
    case "\${words[2]}" in
      setup) _values 'setup option' --yes --ai --no-ai '--root[path]:directory:_directories' '--remove-root[path]:directory:_directories' '--depth[depth]:depth:' --help; return ;;
      index) _values 'index option' --refresh --help; return ;;
      alias) _values 'alias command' list forget --help; return ;;
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

${explicit()}

${nativeError()}

${jumper()}

${completer()}
`;
