import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { isProtocolSafePath, isUnder } from '../paths.js';
import type { DirIndex, IndexEntry, TruncationReason } from './indexer.js';

const PREVIOUS_INDEX_VERSION = 2;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface StoredEntry {
  readonly path: string;
  readonly name: string;
  readonly mtime: number;
  readonly root: string;
  readonly realPath?: string;
}

const readStoredEntry = (value: unknown): StoredEntry | undefined => {
  if (!isRecord(value)) return undefined;
  const { path, name, mtime, root, realPath } = value;
  if (typeof path !== 'string' || !isAbsolute(path) || !isProtocolSafePath(path)) return undefined;
  if (typeof name !== 'string' || name === '' || !isProtocolSafePath(name)) return undefined;
  if (typeof root !== 'string' || !isAbsolute(root)) return undefined;
  if (typeof mtime !== 'number' || !Number.isFinite(mtime) || mtime < 0) return undefined;
  if (realPath !== undefined && (typeof realPath !== 'string' || !isAbsolute(realPath)
    || !isProtocolSafePath(realPath))) return undefined;
  const base = { path, name, mtime, root };
  return realPath === undefined ? base : { ...base, realPath };
};

const currentEntry = (value: unknown): IndexEntry | undefined => {
  const entry = readStoredEntry(value);
  return entry?.realPath === undefined ? undefined : { ...entry, realPath: entry.realPath };
};

const canonical = (path: string): string | undefined => {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
};

const previousEntry = (
  value: unknown,
  roots: Map<string, string | undefined>,
): IndexEntry | undefined => {
  const entry = readStoredEntry(value);
  if (entry === undefined) return undefined;
  if (!roots.has(entry.root)) roots.set(entry.root, canonical(entry.root));
  const realRoot = roots.get(entry.root);
  const realPath = canonical(entry.path);
  if (realRoot === undefined || realPath === undefined || !isUnder(realPath, realRoot)) return undefined;
  return { ...entry, realPath };
};

const truncation = (value: unknown): TruncationReason | null =>
  value === 'entries' || value === 'time' ? value : null;

export interface ParsedIndex {
  readonly index: DirIndex;
  readonly migrated: boolean;
}

export const parseIndex = (value: unknown, currentVersion: number): ParsedIndex | undefined => {
  if (!isRecord(value) || !Array.isArray(value['entries'])) return undefined;
  const version = value['version'];
  if (version !== currentVersion && version !== PREVIOUS_INDEX_VERSION) return undefined;
  const roots = new Map<string, string | undefined>();
  const reader = version === currentVersion
    ? currentEntry
    : (entry: unknown): IndexEntry | undefined => previousEntry(entry, roots);
  const generatedAt = value['generatedAt'];
  const configKey = value['configKey'];
  return {
    index: {
      version: currentVersion,
      generatedAt: typeof generatedAt === 'number' && Number.isFinite(generatedAt) && generatedAt >= 0
        ? generatedAt : 0,
      configKey: typeof configKey === 'string' ? configKey : '',
      truncated: truncation(value['truncated']),
      entries: value['entries'].map(reader).filter((entry): entry is IndexEntry => entry !== undefined),
    },
    migrated: version !== currentVersion,
  };
};
