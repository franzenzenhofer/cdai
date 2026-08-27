import { dataDir } from '../paths.js';
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

const jumper = (): string => `cdai() {
  if [ "$#" -eq 0 ]; then
    builtin cd -- "$HOME"
    return
  fi
  if [ "$#" -eq 1 ] && [ "$1" = "-" ]; then
    builtin cd -
    return
  fi
  if [ "$#" -eq 1 ] && [ -d "$1" ]; then
    builtin cd -- "$1"
    return
  fi
  local result
  result="$(command \${CDAI_BIN:-cdai} query -- "$@")" || return $?
  [ -n "$result" ] && builtin cd -- "$result"
}`;

/** Emitted by `cdai init bash`. PROMPT_COMMAND is the bash equivalent of the zsh chpwd hook. */
export const bashInit = (): string => `# cdai shell integration (bash)
: \${CDAI_DATA_DIR:=${shellQuote(dataDir())}}
_CDAI_DATA="$CDAI_DATA_DIR"
[ -d "$_CDAI_DATA" ] || mkdir -p "$_CDAI_DATA"

${recorder()}

${jumper()}
`;
