import { CD_MAX_NATIVE_ARGS } from '../shell/control.js';
import {
  absolutize, dirOf, fileUrlPath, isDirectory, isFile, isPathShaped, spelledPath,
} from '@franzenzenhofer/intent-core/paths';

/**
 * A place, out of a word that spells one. cdai only ever answers with a directory, so a
 * spelled-out FILE means the directory that holds it - which is the difference between this
 * and the shared primitive it is built on.
 */
const spelledDirectory = (word: string): string | null => {
  const path = spelledPath(word);
  if (path === null) return null;
  if (isDirectory(path)) return path;
  return isFile(path) ? dirOf(path) : null;
};

/** The one thing a lone argument can name outright: an existing directory, spelled either way. */
const namedDirectory = (args: readonly string[]): string | null => {
  const first = args.length === 1 ? args[0] : undefined;
  if (first === undefined) return null;
  const path = absolutize(fileUrlPath(first) ?? first);
  return isDirectory(path) ? path : null;
};

/**
 * A location spelled out among the words is the answer, not a term to search by. "open this
 * ~/dev/newsletter/2026-09-07/newsletter.html" carries the destination in full, and no ranking
 * over remembered names could improve on the path the user already pasted.
 */
export const spelledPlace = (args: readonly string[]): string | null => {
  const named = namedDirectory(args);
  if (named !== null) return named;
  for (const arg of args) {
    const place = spelledDirectory(arg);
    if (place !== null) return place;
  }
  return null;
};

/**
 * Words the shell's own `cd` could have carried: no more of them than the builtin takes, and at
 * least one spelling a location rather than naming one. Every tier still gets its full attempt at
 * them - a pasted path with a typo in it may well be a place this machine knows - but when none
 * answers, the builtin's own error is the truthful one and only the shell can word it.
 */
export const nativeCdWords = (args: readonly string[]): boolean =>
  args.length <= CD_MAX_NATIVE_ARGS && args.some(isPathShaped);
