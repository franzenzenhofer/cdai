import { contractTilde } from '@franzenzenhofer/intent-core/paths';
import { emit, note } from '@franzenzenhofer/intent-core/protocol';

export { emit, note, fail } from '@franzenzenhofer/intent-core/protocol';

/**
 * stdout is the machine channel and carries the resolved path and nothing else.
 * Every human-facing byte goes to stderr, so `$(cdai query ...)` is always clean.
 */
export const EXIT = {
  /** A path was printed on stdout, the shell function should cd to it. */
  ok: 0,
  /** Something went wrong (no match, bad usage, unreadable config). */
  error: 1,
  /** A navigation request was handled but deliberately aborted, so the shell stays put. */
  noCd: 3,
  /**
   * Nothing here answered words the shell's own `cd` could have taken, and nothing was printed:
   * the builtin's error is the truthful one and only the shell can word it.
   */
  native: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** cdai's own stdout contract: one absolute path, and nothing else, ever. */
export const emitPath = (path: string): void => {
  emit(path);
};

export const jump = (path: string): void => {
  note(`→ ${contractTilde(path)}`);
  emitPath(path);
};
