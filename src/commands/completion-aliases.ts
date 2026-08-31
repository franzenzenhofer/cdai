import { isSmartNameMatch } from '../match/completion.js';
import { isUnder } from '../paths.js';
import { stripCdOptions } from '../shell/control.js';
import type { Config } from '../config.js';
import type { IntentAlias } from '../store/aliases.js';
import { basename } from 'node:path';

const isPathIntent = (words: readonly string[]): boolean =>
  words.some((word) => word.includes('/') || word.startsWith('~'));

const aliasWord = (typed: readonly string[], alias: IntentAlias): string | undefined => {
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
  aliases: readonly IntentAlias[],
  config: Config,
): string[] => {
  const words = stripCdOptions(args);
  if (words.length === 0 || isPathIntent(words)) return [];
  return aliases
    .filter((alias) => config.roots.some((root) => isUnder(alias.path, root.path)))
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
