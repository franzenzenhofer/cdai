import { dataDir } from '../paths.js';
import { CLI_CONTROL_PATTERN } from './control.js';
import { shellQuote } from './quote.js';

const recorder = (): string => `if [ -n "\${EPOCHSECONDS+x}" ]; then
  __cdai_now() { printf '%s' "$EPOCHSECONDS"; }
else
  __cdai_now() { date +%s; }
fi

__cdai_record() {
  [ "$PWD" = "$__CDAI_LAST" ] && return 0
  __CDAI_LAST="$PWD"
  printf '%s\\t%s\\n' "$(__cdai_now)" "$PWD" >> "$_CDAI_DATA/visits.log" 2>/dev/null
}
case "$PROMPT_COMMAND" in
  *__cdai_record*) ;;
  *) PROMPT_COMMAND="__cdai_record\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac`;

const runner = (): string => `__cdai_run() {
  command \${CDAI_BIN:-cdai} "$@"
}`;

const jumper = (): string => `cdai() {
  case "\${1-}" in
    ${CLI_CONTROL_PATTERN}) __cdai_run "$@"; return $? ;;
  esac
  if [ "$#" -gt 0 ] && [ "\${1#-}" != "$1" ]; then
    builtin cd "$@"
    return
  fi
  builtin cd -- "$@" 2>/dev/null && return
  local result
  result="$(__cdai_run query -- "$@")" || return $?
  [ -n "$result" ] && builtin cd -- "$result"
}`;

const completer = (): string => `__cdai_complete() {
  local current="\${COMP_WORDS[COMP_CWORD]}"
  local candidate
  COMPREPLY=()
  if [ "\${current#-}" != "$current" ]; then
    COMPREPLY=( $(compgen -W '-L -P -e --' -- "$current") )
    return
  fi
  while IFS= read -r candidate; do
    [ -n "$candidate" ] && COMPREPLY[\${#COMPREPLY[@]}]="$candidate"
  done < <(compgen -d -- "$current")
  while IFS= read -r candidate; do
    [ -n "$candidate" ] && COMPREPLY[\${#COMPREPLY[@]}]="$candidate"
  done < <(__cdai_run complete -- "\${COMP_WORDS[@]:1}" 2>/dev/null)
}
complete -o filenames -F __cdai_complete cdai`;

/** Emitted by `cdai init bash`. PROMPT_COMMAND is the bash equivalent of the zsh chpwd hook. */
export const bashInit = (): string => `# cdai shell integration (bash)
: \${CDAI_DATA_DIR:=${shellQuote(dataDir())}}
_CDAI_DATA="$CDAI_DATA_DIR"
[ -d "$_CDAI_DATA" ] || mkdir -p "$_CDAI_DATA"

${recorder()}

${runner()}

${jumper()}

${completer()}
`;
