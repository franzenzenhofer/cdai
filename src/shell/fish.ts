import { dataDir } from '../paths.js';
import { fishQuote } from './quote.js';

const recorder = (): string => `function __cdai_record --on-variable PWD
    printf '%s\\t%s\\n' (date +%s) "$PWD" >> "$CDAI_DATA_DIR/visits.log" 2>/dev/null
end`;

const jumper = (): string => `function cdai
    if test (count $argv) -gt 0
        if string match -qr '^[-+]' -- "$argv[1]"
            builtin cd $argv
            return
        end
    end
    builtin cd -- $argv 2>/dev/null
    and return
    set -l bin cdai
    if set -q CDAI_BIN
        set bin (string split ' ' -- $CDAI_BIN)
    end
    set -l result (command $bin query -- $argv)
    or return $status
    if test -n "$result"
        builtin cd -- "$result"
    end
end`;

const completer = (): string => `function __cdai_complete
    set -l bin cdai
    if set -q CDAI_BIN
        set bin (string split ' ' -- $CDAI_BIN)
    end
    set -l words (commandline -opc)
    set -l current (commandline -ct)
    if test -n "$current"
        if test (count $words) -eq 0; or test "$words[-1]" != "$current"
            set -a words "$current"
        end
    end
    command $bin complete -- $words[2..-1] 2>/dev/null
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

${jumper()}

${completer()}
`;
