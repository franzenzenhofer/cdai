import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { tryReadJson } from '../json.js';
import { aliasesFile, writeAtomic } from '../paths.js';

const ALIAS_VERSION = 1;
export const MAX_ALIASES = 256;
const MAX_QUERY_LENGTH = 512;

export interface IntentAlias {
  readonly query: string;
  readonly path: string;
  readonly updatedAt: number;
}

export interface AliasDb {
  readonly version: number;
  readonly aliases: readonly IntentAlias[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const normalizeIntent = (query: string): string =>
  query.trim().toLowerCase().replace(/\s+/g, ' ');

const readAlias = (value: unknown): IntentAlias | undefined => {
  if (!isRecord(value)) return undefined;
  const { query, path, updatedAt } = value;
  if (typeof query !== 'string' || query === '' || query.length > MAX_QUERY_LENGTH) return undefined;
  if (typeof path !== 'string' || !isAbsolute(path)) return undefined;
  if (typeof updatedAt !== 'number' || !Number.isSafeInteger(updatedAt) || updatedAt < 0) return undefined;
  return { query, path, updatedAt };
};

export const emptyAliases = (): AliasDb => ({ version: ALIAS_VERSION, aliases: [] });

export const loadAliases = (): AliasDb => {
  const file = aliasesFile();
  if (!existsSync(file)) return emptyAliases();
  const parsed = tryReadJson(file);
  if (!isRecord(parsed) || parsed['version'] !== ALIAS_VERSION || !Array.isArray(parsed['aliases'])) {
    return emptyAliases();
  }
  const aliases = parsed['aliases']
    .slice(0, MAX_ALIASES)
    .map(readAlias)
    .filter((a): a is IntentAlias => a !== undefined);
  return { version: ALIAS_VERSION, aliases };
};

const saveAliases = (aliases: readonly IntentAlias[]): void => {
  writeAtomic(aliasesFile(), `${JSON.stringify({ version: ALIAS_VERSION, aliases })}\n`);
};

export const findAlias = (query: string): IntentAlias | undefined => {
  const normalized = normalizeIntent(query);
  if (normalized === '') return undefined;
  return loadAliases().aliases.find((alias) => alias.query === normalized);
};

export const rememberAlias = (query: string, path: string, updatedAt: number): void => {
  const normalized = normalizeIntent(query);
  if (normalized === '' || normalized.length > MAX_QUERY_LENGTH || !isAbsolute(path)) return;
  const rest = loadAliases().aliases.filter((alias) => alias.query !== normalized);
  saveAliases([{ query: normalized, path, updatedAt }, ...rest].slice(0, MAX_ALIASES));
};

export const forgetAlias = (query: string): void => {
  const normalized = normalizeIntent(query);
  const db = loadAliases();
  const kept = db.aliases.filter((alias) => alias.query !== normalized);
  if (kept.length !== db.aliases.length) saveAliases(kept);
};
