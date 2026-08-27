import { dataDir } from '../paths.js';
import { shellQuote } from './quote.js';

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

__cdai_record() {
  print -r -- "\${EPOCHSECONDS}"$'\\t'"\${PWD}" >> "$_CDAI_DATA/visits.log" 2>/dev/null
}
add-zsh-hook chpwd __cdai_record

cdai() {
  if (( $# == 0 )); then
    builtin cd -- "$HOME"
    return
  fi
  if [[ $# -eq 1 && "$1" == "-" ]]; then
    builtin cd -
    return
  fi
  if [[ $# -eq 1 && -d "$1" ]]; then
    builtin cd -- "$1"
    return
  fi
  local result
  result="$(command \${=CDAI_BIN:-cdai} query -- "$@")" || return $?
  [[ -n "$result" ]] && builtin cd -- "$result"
}
`;
