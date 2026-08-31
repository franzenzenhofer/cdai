import { dataDir } from '../paths.js';
import { CLI_CONTROL_WORDS } from './control.js';
import { fishQuote } from './quote.js';
import { fishSmartTab } from './fish-smart-tab.js';

const recorder = (): string => `function __cdai_record --on-variable PWD
    set -l previous_umask (umask)
    umask 077
    printf '%s\\t%s\\n' (date +%s) "$PWD" >> "$CDAI_DATA_DIR/visits.log" 2>/dev/null
    umask $previous_umask
end`;

const runner = (): string => `function __cdai_run
    set -l bin cdai
    if set -q CDAI_BIN
        set bin (string split ' ' -- $CDAI_BIN)
    end
    command $bin $argv
end`;

const flagDetection = (): string => `set -g _CDAI_FISH_CD_FLAGS 0
if builtin cd -L -- "$PWD" 2>/dev/null
    set _CDAI_FISH_CD_FLAGS 1
end`;

const argumentParser = (): string => `function __cdai_parse
    set -g _CDAI_CD_FLAGS
    set -g _CDAI_QUERY
    set -l parsing 1
    set -l literal 0
    for arg in $argv
        if test $parsing -eq 1; and test "$arg" = "--"
            set parsing 0
            set literal 1
        else if test $parsing -eq 1; and test $_CDAI_FISH_CD_FLAGS -eq 1; and string match -qr '^-[LP]+$' -- "$arg"
            set -a _CDAI_CD_FLAGS "$arg"
        else if test $parsing -eq 1; and test $_CDAI_FISH_CD_FLAGS -eq 1; and contains -- "$arg" --no-dereference --dereference
            set -a _CDAI_CD_FLAGS "$arg"
        else if test $literal -eq 0; and string match -qr '^[-+]' -- "$arg"
            return 1
        else
            set parsing 0
            set -a _CDAI_QUERY "$arg"
        end
    end
    return 0
end`;

const explicit = (): string => `function __cdai_explicit
    for arg in $_CDAI_QUERY
        if string match -qr '(^~|/)' -- "$arg"
            return 0
        end
    end
    return 1
end`;

const parser = (): string => `${flagDetection()}\n\n${argumentParser()}\n\n${explicit()}`;

const jumper = (): string => `function cdai
    if test (count $argv) -gt 0; and contains -- "$argv[1]" --help -h --version -v
        __cdai_run $argv
        return $status
    end
    if test (count $argv) -gt 0; and contains -- "$argv[1]" ${CLI_CONTROL_WORDS}
        if test (count $argv) -eq 1
            cd "$argv[1]" 2>/dev/null
            and return
        end
        __cdai_run $argv
        return $status
    end
    cd $argv 2>/dev/null
    and return
    if not __cdai_parse $argv
        cd $argv
        return $status
    end
    if test (count $_CDAI_QUERY) -eq 0; or __cdai_explicit
        cd $argv
        return $status
    end
    set -l result (__cdai_run query -- $_CDAI_QUERY)
    or return $status
    if test -n "$result"
        cd $_CDAI_CD_FLAGS -- "$result"
    end
end`;

const setupCompleter = (): string => `function __cdai_setup_complete
    set -l previous ''
    if test (count $argv) -gt 1
        set previous $argv[-2]
    end
    switch "$previous"
        case --root --remove-root
            __fish_complete_directories "$argv[-1]"
        case --depth
            printf '%s\\n' 1 2 3 4 5 8 16 32 64
        case '*'
            printf '%s\\n' --yes --ai --no-ai --root --remove-root --depth --help
    end
end`;

const managementCompleter = (): string => `${setupCompleter()}

function __cdai_management_complete
switch $argv[1]
    case setup
        __cdai_setup_complete $argv
        return 0
    case index
        printf '%s\\n' --refresh --help
        return 0
    case alias
        printf '%s\\n' list forget --help
        return 0
    case init
        printf '%s\\n' zsh bash fish --help
        return 0
    case import
        printf '%s\\n' zoxide --help
        return 0
    case doctor
        printf '%s\\n' --help
        return 0
end
return 1
end`;

const queryCompleter = (): string => `set -l option_position 1
if test (count $query) -gt 1
    for word in $query[1..-2]
        if not string match -qr '^-[LP]+$' -- "$word"; and not contains -- "$word" --no-dereference --dereference
            set option_position 0
        end
    end
end
if not __cdai_parse $query
    return
end
if test $option_position -eq 1; and string match -qr '^-' -- "$current"; and not contains -- -- $query
    printf '%s\\n' --
    if test $_CDAI_FISH_CD_FLAGS -eq 1
        printf '%s\\n' -L -P --no-dereference --dereference
    end
    return
end
__fish_complete_directories "$current"
if functions -q __fish_complete_cd
    __fish_complete_cd
end
if test (count $query) -le 1
    printf '%s\\n' ${CLI_CONTROL_WORDS}
end
__cdai_run complete -- $_CDAI_QUERY 2>/dev/null`;

const completer = (): string => `${managementCompleter()}

function __cdai_complete
    set -l words (commandline -opc)
    set -l current (commandline -ct)
    if test -z "$current"
        set -a words ""
    else if test (count $words) -eq 0; or test "$words[-1]" != "$current"
        set -a words "$current"
    end
    set -l query $words[2..-1]
    if test (count $query) -gt 0; and __cdai_management_complete $query
        return
    end
    ${queryCompleter()}
end
complete -c cdai -f -k -a '(__cdai_complete)'`;

/** Emitted by `cdai init fish`. fish reacts to directory changes via the PWD variable event. */
export const fishInit = (): string => `# cdai shell integration (fish)
if not set -q CDAI_DATA_DIR
    set -gx CDAI_DATA_DIR ${fishQuote(dataDir())}
end
if not test -d "$CDAI_DATA_DIR"
    mkdir -p "$CDAI_DATA_DIR"
end
chmod 700 "$CDAI_DATA_DIR" 2>/dev/null

${recorder()}

${runner()}

${parser()}

${jumper()}

${completer()}

${fishSmartTab()}
`;
