import { dataDir } from '../paths.js';
import { fishQuote } from './quote.js';

const recorder = (): string => `function __cdai_record --on-variable PWD
    printf '%s\\t%s\\n' (date +%s) "$PWD" >> "$CDAI_DATA_DIR/visits.log" 2>/dev/null
end`;

const jumper = (): string => `function cdai
    if test (count $argv) -eq 0
        builtin cd -- "$HOME"
        return
    end
    if test (count $argv) -eq 1; and test "$argv[1]" = "-"
        builtin cd -
        return
    end
    if test (count $argv) -eq 1; and test -d "$argv[1]"
        builtin cd -- "$argv[1]"
        return
    end
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
`;
