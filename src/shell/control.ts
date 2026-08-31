/** Commands owned by the cdai executable rather than the shell's `cd` builtin. */
export const CLI_CONTROLS = [
  'init',
  'setup',
  'index',
  'import',
  'doctor',
  'query',
  'complete',
  '--help',
  '-h',
  '--version',
  '-v',
] as const;

export const CLI_CONTROL_PATTERN = CLI_CONTROLS.join('|');
export const CLI_CONTROL_WORDS = CLI_CONTROLS.join(' ');
