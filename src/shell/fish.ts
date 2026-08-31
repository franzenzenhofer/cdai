import { dataDir } from '../paths.js';
import { CLI_CONTROL_WORDS } from './control.js';
import { fishQuote } from './quote.js';

const recorder = (): string => `function __cdai_record --on-variable PWD
    printf '%s\\t%s\\n' (date +%s) "$PWD" >> "$CDAI_DATA_DIR/visits.log" 2>/dev/null
end`;

const runner = (): string => `function __cdai_run
    set -l bin cdai
    if set -q CDAI_BIN
        set bin (string split ' ' -- $CDAI_BIN)
    end
    command $bin $argv
end`;

const jumper = (): string => `function cdai
    if test (count $argv) -gt 0; and contains -- "$argv[1]" ${CLI_CONTROL_WORDS}
        __cdai_run $argv
        return $status
    end
    builtin cd $argv 2>/dev/null
    and return
    set -l query $argv
    if test (count $query) -gt 0; and test "$query[1]" = "--"
        set -e query[1]
    else if test (count $query) -gt 0; and string match -qr '^[-+]' -- "$query[1]"
        builtin cd $argv
        return $status
    end
    if test (count $query) -eq 0; or string match -qr '(^~|/)' -- "$query[1]"
        builtin cd $argv
        return $status
    end
    set -l result (__cdai_run query -- $query)
    or return $status
    if test -n "$result"
        builtin cd -- "$result"
    end
end`;

const completer = (): string => `function __cdai_complete
    set -l words (commandline -opc)
    set -l current (commandline -ct)
    if test -n "$current"
        if test (count $words) -eq 0; or test "$words[-1]" != "$current"
            set -a words "$current"
        end
    end
    set -l query $words[2..-1]
    if test (count $query) -gt 0; and test "$query[1]" = "--"
        set -e query[1]
    else if test (count $query) -gt 0; and string match -qr '^[-+]' -- "$query[1]"
        return
    end
    __cdai_run complete -- $query 2>/dev/null
end
complete -c cdai -a '(__cdai_complete)'`;

/** Emitted by `cdai init fish`. fish reacts to directory changes via the PWD variable event. */
export const fishInit = (): string => `# cdai shell integration (fish)
if not set -q CDAI_DATA_DIR
    set -gx CDAI_DATA_DIR ${fishQuote(dataDir())}
end
if not test -d "$CDAI_DATA_DIR"
    mkdir -p "$CDAI_DATA_DIR"
end

${recorder()}

${runner()}

${jumper()}

${completer()}
`;
