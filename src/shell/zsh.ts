import { dataDir } from '../paths.js';
import { CLI_CONTROL_PATTERN, ZSH_CD_FLAG_CHARS } from './control.js';
import { shellQuote } from './quote.js';

const recorder = (): string => `__cdai_record() {
  print -r -- "\${EPOCHSECONDS}"$'\\t'"\${PWD}" >> "$_CDAI_DATA/visits.log" 2>/dev/null
}
add-zsh-hook chpwd __cdai_record`;

const runner = (): string => `__cdai_run() {
  command \${=CDAI_BIN:-cdai} "$@"
}`;

const parser = (): string => `__cdai_parse() {
  typeset -ga _CDAI_CD_FLAGS _CDAI_QUERY
  _CDAI_CD_FLAGS=()
  _CDAI_QUERY=()
  local arg parsing=1
  for arg in "$@"; do
    if (( parsing )) && [[ "$arg" == -- ]]; then
      parsing=0
    elif (( parsing )) && [[ "$arg" =~ ^-[${ZSH_CD_FLAG_CHARS}]+$ ]]; then
      _CDAI_CD_FLAGS+=("$arg")
    elif (( parsing )) && [[ "$arg" == [-+]* ]]; then
      return 1
    else
      parsing=0
      _CDAI_QUERY+=("$arg")
    fi
  done
}`;

const jumper = (): string => `cdai() {
  if (( $# > 0 )) && [[ "$1" == (${CLI_CONTROL_PATTERN}) ]]; then
    __cdai_run "$@"
    return $?
  fi
  builtin cd "$@" 2>/dev/null && return
  if ! __cdai_parse "$@"; then
    builtin cd "$@"
    return
  fi
  if (( \${#_CDAI_QUERY} == 0 )) || [[ "\${_CDAI_QUERY[1]}" == */* || "\${_CDAI_QUERY[1]}" == '~'* ]]; then
    builtin cd "$@"
    return
  fi
  local result
  result="$(__cdai_run query -- "\${_CDAI_QUERY[@]}")" || return $?
  [[ -n "$result" ]] && builtin cd "\${_CDAI_CD_FLAGS[@]}" -- "$result"
}`;

const completer = (): string => `__cdai_complete() {
  local service=cd
  local -a indexed
  _cd
  if __cdai_parse "\${words[@]:1}"; then
    indexed=("\${(@f)$(__cdai_run complete -- "\${_CDAI_QUERY[@]}" 2>/dev/null)}")
  fi
  indexed=("\${(@)indexed:#}")
  (( \${#indexed} > 0 )) && compadd -U -- "\${indexed[@]}"
}

if [[ -o interactive ]]; then
  autoload -Uz compinit
  (( $+functions[compdef] )) || compinit
  autoload -Uz _cd
  compdef __cdai_complete cdai
fi`;

/**
 * Emitted by `cdai init zsh` and consumed via eval. Recording is pure zsh builtins so the
 * prompt never pays for a subprocess; the binary ingests visits.log on its next run.
 */
export const zshInit = (): string => `# cdai shell integration (zsh)
zmodload zsh/datetime 2>/dev/null
autoload -Uz add-zsh-hook
: \${CDAI_DATA_DIR:=${shellQuote(dataDir())}}
typeset -g _CDAI_DATA=\${CDAI_DATA_DIR}
[[ -d "$_CDAI_DATA" ]] || mkdir -p "$_CDAI_DATA"

${recorder()}

${runner()}

${parser()}

${jumper()}

${completer()}
`;
