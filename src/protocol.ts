import { contractTilde } from './paths.js';

/**
 * stdout is the machine channel and carries the resolved path and nothing else.
 * Every human-facing byte goes to stderr, so `$(cdai query ...)` is always clean.
 */
export const EXIT = {
  /** A path was printed on stdout, the shell function should cd to it. */
  ok: 0,
  /** Something went wrong (no match, bad usage, unreadable config). */
  error: 1,
  /** Handled, but deliberately no cd (user aborted the picker, doctor/setup output). */
  noCd: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export const emitPath = (path: string): void => {
  process.stdout.write(`${path}\n`);
};

export const note = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

export const jump = (path: string): void => {
  note(`→ ${contractTilde(path)}`);
  emitPath(path);
};

export const fail = (message: string, hint?: string): void => {
  note(`cdai: ${message}`);
  if (hint !== undefined) note(`      ${hint}`);
};
