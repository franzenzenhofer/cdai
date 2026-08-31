import { dataDir } from '../paths.js';
import {
  BASH_PORTABLE_CD_FLAG_CHARS,
  CLI_CONTROL_PATTERN,
  CLI_CONTROL_WORDS,
} from './control.js';
import { shellQuote } from './quote.js';

const recorder = (): string => `if [ -n "\${EPOCHSECONDS+x}" ]; then
  __cdai_now() { printf '%s' "$EPOCHSECONDS"; }
else
  __cdai_now() { date +%s; }
fi

__cdai_record() {
  local previous_status=$?
  if [ "$PWD" != "$__CDAI_LAST" ]; then
    __CDAI_LAST="$PWD"
    local previous_umask
    previous_umask="$(umask)"
    umask 077
    printf '%s\\t%s\\n' "$(__cdai_now)" "$PWD" >> "$_CDAI_DATA/visits.log" 2>/dev/null
    umask "$previous_umask"
  fi
  return "$previous_status"
}
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == 'declare -a'* ]]; then
  case " \${PROMPT_COMMAND[*]} " in
    *' __cdai_record '*) ;;
    *) PROMPT_COMMAND=(__cdai_record "\${PROMPT_COMMAND[@]}") ;;
  esac
else
  case "\${PROMPT_COMMAND}" in
    *__cdai_record*) ;;
    *) PROMPT_COMMAND="__cdai_record\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
  esac
fi`;

const runner = (): string => `__cdai_run() {
  command \${CDAI_BIN:-cdai} "$@"
}`;

const flagDetection = (): string => `_CDAI_BASH_CD_FLAG_CHARS='${BASH_PORTABLE_CD_FLAG_CHARS}'
_CDAI_BASH_CD_OPTIONS='-L -P'
_CDAI_BASH_CD_HELP="$(help cd 2>/dev/null)"
if [[ "$_CDAI_BASH_CD_HELP" == *'-e'* ]]; then
  _CDAI_BASH_CD_FLAG_CHARS+='e'
  _CDAI_BASH_CD_OPTIONS+=' -e'
fi
if [[ "$_CDAI_BASH_CD_HELP" == *'-@'* ]]; then
  _CDAI_BASH_CD_FLAG_CHARS+='@'
  _CDAI_BASH_CD_OPTIONS+=' -@'
fi
unset _CDAI_BASH_CD_HELP`;

const parser = (): string => `__cdai_parse() {
  _CDAI_CD_FLAGS=()
  _CDAI_QUERY=()
  local arg parsing=1 literal=0
  for arg in "$@"; do
    if [ "$parsing" -eq 1 ] && [ "$arg" = "--" ]; then
      parsing=0
      literal=1
    elif [ "$parsing" -eq 1 ] && [[ "$arg" =~ ^-[$_CDAI_BASH_CD_FLAG_CHARS]+$ ]]; then
      _CDAI_CD_FLAGS+=("$arg")
    elif [ "$literal" -eq 0 ] && [[ "$arg" == [-+]* ]]; then
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
  local output status
  output="$(builtin cd "$@" 2>&1)"
  status=$?
  output="\${output#*cd: }"
  [ -n "$output" ] && printf 'cdai: cd: %s\\n' "$output" >&2
  return "$status"
}`;

const jumper = (): string => `cdai() {
  case "\${1-}" in
    --help|-h|--version|-v) __cdai_run "$@"; return $? ;;
    ${CLI_CONTROL_PATTERN})
      if [ "$#" -eq 1 ]; then
        builtin cd "$1" 2>/dev/null && return
      fi
      __cdai_run "$@"; return $? ;;
  esac
  builtin cd "$@" 2>/dev/null && return
  if ! __cdai_parse "$@"; then
    __cdai_native_error "$@"
    return $?
  fi
  if [ "\${#_CDAI_QUERY[@]}" -eq 0 ] || __cdai_explicit; then
    __cdai_native_error "$@"
    return $?
  fi
  local result
  result="$(__cdai_run query -- "\${_CDAI_QUERY[@]}")" || return $?
  [ -n "$result" ] && builtin cd "\${_CDAI_CD_FLAGS[@]}" -- "$result"
}`;

const managementCompleter = (): string => `if [ "$COMP_CWORD" -ge 2 ]; then
  case "\${COMP_WORDS[1]}" in
    setup)
      case "\${COMP_WORDS[COMP_CWORD-1]}" in
        --root|--remove-root)
          while IFS= read -r candidate; do
            [ -n "$candidate" ] && COMPREPLY[\${#COMPREPLY[@]}]="$candidate"
          done < <(compgen -d -- "$current") ;;
        --depth) COMPREPLY=( $(compgen -W '1 2 3 4 5 8 16 32 64' -- "$current") ) ;;
        *) COMPREPLY=( $(compgen -W '--yes --ai --no-ai --root --remove-root --depth --help' -- "$current") ) ;;
      esac
      return ;;
    index) COMPREPLY=( $(compgen -W '--refresh --help' -- "$current") ); return ;;
    alias) COMPREPLY=( $(compgen -W 'list forget --help' -- "$current") ); return ;;
    init) COMPREPLY=( $(compgen -W 'zsh bash fish --help' -- "$current") ); return ;;
    import) COMPREPLY=( $(compgen -W 'zoxide --help' -- "$current") ); return ;;
    doctor) COMPREPLY=( $(compgen -W '--help' -- "$current") ); return ;;
  esac
fi`;

const replyHelper = (): string => `__cdai_reply() {
  local existing
  for existing in "\${COMPREPLY[@]}"; do [ "$existing" = "$1" ] && return; done
  COMPREPLY[\${#COMPREPLY[@]}]="$1"
}`;

const optionTracker = (): string => `for word in "\${COMP_WORDS[@]:1:COMP_CWORD-1}"; do
    if [ "$word" = '--' ]; then
      terminated=1
      option_position=0
    elif [[ ! "$word" =~ ^-[$_CDAI_BASH_CD_FLAG_CHARS]+$ ]]; then
      option_position=0
    fi
  done`;

const cdpathCompleter = (): string => `if [[ -n "\${CDPATH-}" && "$current" != /* && "$current" != ./* && "$current" != ../* && "$current" != '~'* ]]; then
    local base previous_ifs="$IFS"
    IFS=:
    for base in $CDPATH; do
      [ -n "$base" ] || base=.
      while IFS= read -r candidate; do
        [ -n "$candidate" ] && __cdai_reply "\${candidate#"$base"/}"
      done < <(compgen -d -- "$base/$current")
    done
    IFS="$previous_ifs"
  fi`;

const completer = (): string => `__cdai_complete() {
  local current="\${COMP_WORDS[COMP_CWORD]}" candidate word terminated=0 option_position=1
  COMPREPLY=()
  ${optionTracker()}
  ${managementCompleter()}
  if [ "$terminated" -eq 0 ] && [ "$option_position" -eq 1 ] && [ "\${current#-}" != "$current" ]; then
    COMPREPLY=( $(compgen -W "$_CDAI_BASH_CD_OPTIONS --" -- "$current") )
    return
  fi
  ${replyHelper()}
  while IFS= read -r candidate; do
    [ -n "$candidate" ] && __cdai_reply "$candidate"
  done < <(compgen -d -- "$current")
  ${cdpathCompleter()}
  if [ "$COMP_CWORD" -eq 1 ]; then
    while IFS= read -r candidate; do [ -n "$candidate" ] && __cdai_reply "$candidate"; done \
      < <(compgen -W '${CLI_CONTROL_WORDS}' -- "$current")
  fi
  if __cdai_parse "\${COMP_WORDS[@]:1}"; then
    while IFS= read -r candidate; do
      [ -n "$candidate" ] && __cdai_reply "$candidate"
    done < <(__cdai_run complete -- "\${_CDAI_QUERY[@]}" 2>/dev/null)
  fi
}
complete -o filenames -F __cdai_complete cdai`;

/** Emitted by `cdai init bash`. PROMPT_COMMAND is the bash equivalent of the zsh chpwd hook. */
export const bashInit = (): string => `# cdai shell integration (bash)
: \${CDAI_DATA_DIR:=${shellQuote(dataDir())}}
_CDAI_DATA="$CDAI_DATA_DIR"
[ -d "$_CDAI_DATA" ] || mkdir -p "$_CDAI_DATA"
chmod 700 "$_CDAI_DATA" 2>/dev/null || true

${recorder()}

${runner()}

${flagDetection()}

${parser()}

${explicit()}

${nativeError()}

${jumper()}

${completer()}
`;
