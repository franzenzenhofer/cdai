import { readFileSync, existsSync } from 'node:fs';
import { configFile, writeAtomic } from '@franzenzenhofer/intent-core/paths';
import { withStateLock } from '@franzenzenhofer/intent-core/store/lock';
import { expectKeys, isRecord, readAi, readAliases, readIgnore, readRoots } from './config-read.js';
import { DEFAULT_AI, DEFAULT_IGNORE, type Config } from './config-types.js';

export {
  DEFAULT_AI, DEFAULT_DEPTH, DEFAULT_IGNORE, MAX_DEPTH, WEIGHT_LIMIT,
  type AiConfig, type CdaiRoot, type Config, type ConfigAlias, type RootConfig,
} from './config-types.js';

const TOP_LEVEL_KEYS = ['roots', 'ignore', 'ai', 'aliases'] as const;

export const emptyConfig = (): Config =>
  ({ roots: [], ignore: [...DEFAULT_IGNORE], ai: { ...DEFAULT_AI }, aliases: [] });

export const configExists = (): boolean => existsSync(configFile());

const parseConfig = (raw: string): Config => {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error('must be a JSON object');
  expectKeys(parsed, TOP_LEVEL_KEYS, 'config');
  return {
    roots: readRoots(parsed['roots']),
    ignore: readIgnore(parsed['ignore']),
    ai: readAi(parsed['ai']),
    aliases: readAliases(parsed['aliases']),
  };
};

/** Fails loud, naming the file and the key: a broken config is never replaced by defaults. */
export const loadConfig = (): Config => {
  const file = configFile();
  if (!existsSync(file)) return emptyConfig();
  try {
    return parseConfig(readFileSync(file, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`config error in ${file}: ${reason}`);
  }
};

/**
 * The file's own shape: aliases as a "words": "path" map, and a root's weight only when it has
 * one, so a config without weights keeps the index fingerprint it always had.
 */
export const serializeConfig = (config: Config): string =>
  `${JSON.stringify({
    roots: config.roots,
    ignore: config.ignore,
    ai: config.ai,
    aliases: Object.fromEntries(config.aliases.map((alias) => [alias.query, alias.path])),
  }, null, 2)}\n`;

export const saveConfig = (config: Config): void => {
  withStateLock(configFile(), () => writeAtomic(configFile(), serializeConfig(config)));
};
