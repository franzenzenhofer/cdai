import { absolutize, isProtocolSafePath } from '@franzenzenhofer/intent-core/paths';
import type { AiConfig } from '@franzenzenhofer/intent-core/ai/backend';
import { normalizeIntent } from '@franzenzenhofer/intent-core/store/aliases';
import {
  DEFAULT_AI, DEFAULT_DEPTH, DEFAULT_IGNORE, MAX_DEPTH, MAX_TIMER_MS, WEIGHT_LIMIT,
  type CdaiRoot, type ConfigAlias,
} from './config-types.js';

/**
 * Strict readers for config.json. A value that is present but wrong is an error naming the key,
 * never a silent default: a typo in a hand-edited file must not quietly change what cdai does.
 * Only an absent key takes its default.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalid = (where: string, problem: string): Error => new Error(`${where} ${problem}`);

export const expectKeys = (record: Record<string, unknown>, allowed: readonly string[], where: string): void => {
  const unknown = Object.keys(record).find((key) => !allowed.includes(key));
  if (unknown === undefined) return;
  throw invalid(where, `has unknown key "${unknown}" (allowed: ${allowed.join(', ')})`);
};

/** Absolute or home-relative only: a relative path would mean whatever directory cdai runs in. */
const readPath = (value: unknown, where: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(where, 'must be a non-empty path');
  if (!value.startsWith('/') && !value.startsWith('~')) throw invalid(where, `must start with / or ~, got "${value}"`);
  if (!isProtocolSafePath(value)) throw invalid(where, 'must not contain a line break');
  return absolutize(value);
};

const readInteger = (value: unknown, where: string, min: number, max: number): number => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max) return value;
  throw invalid(where, `must be an integer from ${String(min)} to ${String(max)}, got ${JSON.stringify(value)}`);
};

const readRoot = (entry: unknown, where: string): CdaiRoot => {
  if (typeof entry === 'string') return { path: readPath(entry, where), depth: DEFAULT_DEPTH };
  if (!isRecord(entry)) throw invalid(where, 'must be a path or { "path", "depth", "weight" }');
  expectKeys(entry, ['path', 'depth', 'weight'], where);
  const path = readPath(entry['path'], `${where}.path`);
  const depth = entry['depth'] === undefined ? DEFAULT_DEPTH : readInteger(entry['depth'], `${where}.depth`, 1, MAX_DEPTH);
  if (entry['weight'] === undefined) return { path, depth };
  return { path, depth, weight: readInteger(entry['weight'], `${where}.weight`, -WEIGHT_LIMIT, WEIGHT_LIMIT) };
};

export const readRoots = (value: unknown): CdaiRoot[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid('roots', 'must be an array');
  const roots = value.map((entry, i) => readRoot(entry, `roots[${String(i)}]`));
  const duplicate = roots.find((root, i) => roots.findIndex((other) => other.path === root.path) !== i);
  if (duplicate !== undefined) throw invalid('roots', `lists ${duplicate.path} twice`);
  return roots;
};

export const readIgnore = (value: unknown): string[] => {
  if (value === undefined) return [...DEFAULT_IGNORE];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && v.trim() !== '')) {
    throw invalid('ignore', 'must be an array of directory names');
  }
  return value as string[];
};

const readString = (value: unknown, where: string, fallback: string, allowEmpty: boolean): string => {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && (allowEmpty || value.trim() !== '')) return value;
  throw invalid(where, allowEmpty ? 'must be a string' : 'must be a non-empty string');
};

const readArgs = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
  throw invalid('ai.args', 'must be an array of strings');
};

const readEnabled = (value: unknown): boolean => {
  if (value === undefined) return DEFAULT_AI.enabled;
  if (typeof value === 'boolean') return value;
  throw invalid('ai.enabled', 'must be true or false');
};

export const readAi = (value: unknown): AiConfig => {
  if (value === undefined) return { ...DEFAULT_AI };
  if (!isRecord(value)) throw invalid('ai', 'must be an object');
  expectKeys(value, ['enabled', 'command', 'args', 'model', 'timeoutMs'], 'ai');
  const timeout = value['timeoutMs'];
  return {
    enabled: readEnabled(value['enabled']),
    command: readString(value['command'], 'ai.command', DEFAULT_AI.command, false),
    args: readArgs(value['args']),
    model: readString(value['model'], 'ai.model', DEFAULT_AI.model, true),
    timeoutMs: timeout === undefined ? DEFAULT_AI.timeoutMs : readInteger(timeout, 'ai.timeoutMs', 1, MAX_TIMER_MS),
  };
};

/** `{ "the words": "~/the/directory" }`, the words compared the way a taught alias is. */
export const readAliases = (value: unknown): ConfigAlias[] => {
  if (value === undefined) return [];
  if (!isRecord(value)) throw invalid('aliases', 'must be an object of "words": "path"');
  const aliases: ConfigAlias[] = [];
  for (const [words, path] of Object.entries(value)) {
    const query = normalizeIntent(words);
    const where = `aliases["${words}"]`;
    if (query === '') throw invalid('aliases', 'has an entry without words');
    if (aliases.some((alias) => alias.query === query)) throw invalid(where, 'is listed twice');
    aliases.push({ query, path: readPath(path, where) });
  }
  return aliases;
};
