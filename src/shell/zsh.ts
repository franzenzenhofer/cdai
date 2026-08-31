import { dataDir } from '../paths.js';
import { CLI_CONTROL_PATTERN } from './control.js';
import { shellQuote } from './quote.js';

const recorder = (): string => `__cdai_record() {
  print -r -- "\${EPOCHSECONDS}"$'\\t'"\${PWD}" >> "$_CDAI_DATA/visits.log" 2>/dev/null
}
add-zsh-hook chpwd __cdai_record`;

const runner = (): string => `__cdai_run() {
  command \${=CDAI_BIN:-cdai} "$@"
}`;

const jumper = (): string => `cdai() {
  if (( $# > 0 )) && [[ "$1" == (${CLI_CONTROL_PATTERN}) ]]; then
    __cdai_run "$@"
    return $?
  fi
  if (( $# > 0 )) && [[ "$1" == [-+]* ]]; then
    builtin cd "$@"
    return
  fi
  builtin cd -- "$@" 2>/dev/null && return
  local result
  result="$(__cdai_run query -- "$@")" || return $?
  [[ -n "$result" ]] && builtin cd -- "$result"
}`;

const completer = (): string => `__cdai_complete() {
  local service=cd
  local -a indexed
  _cd
  indexed=("\${(@f)$(__cdai_run complete -- "\${words[@]:1}" 2>/dev/null)}")
  indexed=("\${(@)indexed:#}")
  (( \${#indexed} > 0 )) && compadd -- "\${indexed[@]}"
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

${jumper()}

${completer()}
`;
