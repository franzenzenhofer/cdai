import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { tryReadJson } from '@franzenzenhofer/intent-core/json';
import { isProtocolSafePath, writeAtomic } from '@franzenzenhofer/intent-core/paths';
import { withStateLock } from '@franzenzenhofer/intent-core/store/lock';
import {
  findAlias as coreFind,
  findAliasWhere as coreFindWhere,
  forgetAlias as coreForget,
  loadAliases as coreLoad,
  rememberAlias as coreRemember,
  normalizeIntent,
  MAX_ALIASES,
  type Alias,
  type AliasSpec,
} from '@franzenzenhofer/intent-core/store/aliases';
import { aliasesFile } from '../state.js';

export { MAX_ALIASES, normalizeIntent };

const ALIAS_VERSION = 1;

/** What cdai remembers: one absolute directory, under the exact words that asked for it. */
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

/** cdai's own validator: the shared store keeps the value opaque and asks the product. */
const readPath = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !isAbsolute(value) || !isProtocolSafePath(value)) return undefined;
  return value;
};

const spec: AliasSpec<string> = { file: aliasesFile, readValue: readPath };

/**
 * Aliases written before the store was shared say `path` where it now says `value`.
 *
 * The file is a person's own remembered intents, so it is converted in place the first time it
 * is read rather than quietly dropped for not matching the new shape. Idempotent, and it only
 * touches a file that really carries the old spelling.
 */
const migrateLegacy = (): void => {
  const file = aliasesFile();
  if (!existsSync(file)) return;
  const parsed = tryReadJson(file);
  if (!isRecord(parsed) || !Array.isArray(parsed['aliases'])) return;
  const legacy = parsed['aliases'].filter(
    (entry) => isRecord(entry) && typeof entry['path'] === 'string' && entry['value'] === undefined,
  );
  if (legacy.length === 0) return;
  const aliases = parsed['aliases'].map((entry) => {
    if (!isRecord(entry) || typeof entry['path'] !== 'string') return entry;
    return { query: entry['query'], value: entry['path'], updatedAt: entry['updatedAt'] };
  });
  withStateLock(file, () => {
    writeAtomic(file, `${JSON.stringify({ version: ALIAS_VERSION, aliases })}\n`);
  });
};

// Keyed by file, not a bare flag: one process can be pointed at more than one state directory,
// and the second one would otherwise never be looked at.
const checked = new Set<string>();

const ready = (): AliasSpec<string> => {
  const file = aliasesFile();
  if (!checked.has(file)) {
    migrateLegacy();
    checked.add(file);
  }
  return spec;
};

const toIntent = (alias: Alias<string>): IntentAlias =>
  ({ query: alias.query, path: alias.value, updatedAt: alias.updatedAt });

export const emptyAliases = (): AliasDb => ({ version: ALIAS_VERSION, aliases: [] });

export const loadAliases = (): AliasDb =>
  ({ version: ALIAS_VERSION, aliases: coreLoad(ready()).map(toIntent) });

export const findAlias = (query: string): IntentAlias | undefined => {
  const found = coreFind(ready(), query);
  return found === undefined ? undefined : toIntent(found);
};

/**
 * The first remembered intent the caller accepts. Filler words differ between two typings of the
 * same thing ("the nudge game", "nudge game folder"), and only the caller knows how a query is
 * read, so the comparison itself stays out of the store.
 */
export const findAliasWhere = (
  accepts: (query: string) => boolean,
): IntentAlias | undefined => {
  const found = coreFindWhere(ready(), accepts);
  return found === undefined ? undefined : toIntent(found);
};

export const rememberAlias = (query: string, path: string, updatedAt: number): void => {
  coreRemember(ready(), query, path, updatedAt);
};

export const forgetAlias = (query: string): boolean => coreForget(ready(), query);
