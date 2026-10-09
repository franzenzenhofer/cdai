import { isSmartNameMatch } from '../match/completion.js';
import { isUnder } from '@franzenzenhofer/intent-core/paths';
import { stripCdOptions } from '../shell/control.js';
import type { Config } from '../config.js';
import type { KnownAlias } from './alias-recall.js';
import { basename } from 'node:path';

const isPathIntent = (words: readonly string[]): boolean =>
  words.some((word) => word.includes('/') || word.startsWith('~'));

const aliasWord = (typed: readonly string[], alias: KnownAlias): string | undefined => {
  const expected = alias.query.split(' ');
  const cursor = typed.length - 1;
  if (cursor < 0 || cursor >= expected.length) return undefined;
  if (!typed.slice(0, cursor).every((word, index) => word.toLowerCase() === expected[index])) {
    return undefined;
  }
  const candidate = expected[cursor];
  return candidate !== undefined && isSmartNameMatch(typed[cursor] ?? '', candidate)
    ? candidate
    : undefined;
};

export const completeAliasWords = (
  args: readonly string[],
  aliases: readonly KnownAlias[],
  config: Config,
): string[] => {
  const words = stripCdOptions(args);
  if (words.length === 0 || isPathIntent(words)) return [];
  // A taught alias outside the roots is dropped when used; a declared one is the user's own word.
  return aliases
    .filter((alias) => alias.source === 'config' || config.roots.some((root) => isUnder(alias.path, root.path)))
    .map((alias) => aliasWord(words, alias))
    .filter((word): word is string => word !== undefined);
};

/** `in <root>` completes configured root labels, not destination basenames. */
export const completeRootNames = (args: readonly string[], config: Config): string[] | null => {
  const words = stripCdOptions(args);
  if (words.length < 2 || words.at(-2)?.toLowerCase() !== 'in') return null;
  const fragment = words.at(-1) ?? '';
  return config.roots
    .map((root) => basename(root.path))
    .filter((name) => isSmartNameMatch(fragment, name));
};
