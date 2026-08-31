import { CLI_CONTROL_WORDS } from './control.js';

const bindings = (): string => `if status is-interactive
    bind --preset \\t __cdai_smart_tab
    bind --preset -M insert \\t __cdai_smart_tab
    if not bind --user \\t >/dev/null 2>&1
        bind --user \\t __cdai_smart_tab
    end
    if not bind --user -M insert \\t >/dev/null 2>&1
        bind --user -M insert \\t __cdai_smart_tab
    end
end`;

/** Fish filters typo candidates itself, so replace only cdai's single safe non-prefix result. */
export const fishSmartTab = (): string => `function __cdai_smart_tab
    set -l words (commandline -opc)
    set -l current (commandline -ct)
    if test -n "$current"; and test (count $words) -gt 0; and test "$words[1]" = cdai
        if test "$words[-1]" != "$current"
            set -a words "$current"
        end
        set -l query $words[2..-1]
        if test (count $query) -gt 0; and not contains -- "$query[1]" ${CLI_CONTROL_WORDS}
            if __cdai_parse $query
                set -l indexed (__cdai_run complete -- $_CDAI_QUERY 2>/dev/null)
                if test (count $indexed) -eq 1; and not string match -q -- "$current*" "$indexed[1]"
                    commandline -rt -- (string escape -- "$indexed[1]")
                    return
                end
            end
        end
    end
    commandline -f complete
end

${bindings()}`;
