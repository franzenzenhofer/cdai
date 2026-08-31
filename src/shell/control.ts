/** Commands owned by the cdai executable rather than the shell's `cd` builtin. */
export const CLI_CONTROLS = [
  'init',
  'setup',
  'index',
  'import',
  'doctor',
  'alias',
  'query',
  'complete',
  '--help',
  '-h',
  '--version',
  '-v',
] as const;

export const CLI_CONTROL_PATTERN = CLI_CONTROLS.join('|');
export const CLI_CONTROL_WORDS = CLI_CONTROLS.join(' ');

export const ZSH_CD_FLAG_CHARS = 'qLsP';
export const BASH_CD_FLAG_CHARS = 'LPe@';
export const BASH_PORTABLE_CD_FLAG_CHARS = 'LP';
const CD_FLAG = new RegExp(`^-[${ZSH_CD_FLAG_CHARS}${BASH_CD_FLAG_CHARS}]+$`);

/** Removes recognized leading cd options so cached completion ranks only the user's intent. */
export const stripCdOptions = (args: readonly string[]): string[] => {
  let cursor = 0;
  while (cursor < args.length) {
    const arg = args[cursor];
    if (arg === '--') return args.slice(cursor + 1);
    if (arg === undefined || !CD_FLAG.test(arg)) break;
    cursor += 1;
  }
  return args.slice(cursor);
};
