import type { Config } from '../config.js';
import { intentKey } from '../match/tokenize.js';
import { findAlias, findAliasWhere, loadAliases, normalizeIntent } from '../store/aliases.js';

export type AliasSource = 'config' | 'taught';

/** One remembered intent, and whether it came from config.json or was taught/confirmed. */
export interface KnownAlias {
  readonly query: string;
  readonly path: string;
  readonly source: AliasSource;
}

const fromConfig = (raw: string, config: Config): KnownAlias | undefined => {
  const exact = normalizeIntent(raw);
  const key = intentKey(raw);
  const found = config.aliases.find((alias) => alias.query === exact)
    ?? config.aliases.find((alias) => intentKey(alias.query) === key);
  return found === undefined ? undefined : { ...found, source: 'config' };
};

const fromStore = (raw: string): KnownAlias | undefined => {
  const key = intentKey(raw);
  const found = findAlias(raw) ?? (key === '' ? undefined : findAliasWhere((stored) => intentKey(stored) === key));
  return found === undefined ? undefined : { query: found.query, path: found.path, source: 'taught' };
};

/**
 * The words a person named a directory with, before any matcher guesses: config.json first, then
 * what was taught or confirmed. The exact wording wins over the same wording with other filler
 * words ("go to the ... folder"), and order words and years count, so "mobile first" never
 * answers "latest mobile".
 */
export const recallIntent = (raw: string, config: Config): KnownAlias | undefined =>
  fromConfig(raw, config) ?? fromStore(raw);

/** Every alias in the order recall consults them. */
export const allAliases = (config: Config): KnownAlias[] => [
  ...config.aliases.map((alias): KnownAlias => ({ ...alias, source: 'config' })),
  ...loadAliases().aliases.map((alias): KnownAlias => ({ query: alias.query, path: alias.path, source: 'taught' })),
];
