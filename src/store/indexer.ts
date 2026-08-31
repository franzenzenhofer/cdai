import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { tryReadJson } from '../json.js';
import { indexFile, writeAtomic } from '../paths.js';
import type { Config, RootConfig } from '../config.js';

const INDEX_VERSION = 2;
export const INDEX_TTL_MS = 60 * 60 * 1000;
export const MAX_ENTRIES = 50_000;
export const MAX_WALK_MS = 5000;
const HIDDEN_PREFIX = '.';

export interface IndexEntry {
  readonly path: string;
  readonly name: string;
  readonly mtime: number;
  readonly root: string;
}

export interface DirIndex {
  readonly version: number;
  readonly generatedAt: number;
  readonly configKey: string;
  readonly entries: readonly IndexEntry[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readEntry = (value: unknown): IndexEntry | undefined => {
  if (!isRecord(value)) return undefined;
  const { path, name, mtime, root } = value;
  if (typeof path !== 'string' || !isAbsolute(path) || typeof name !== 'string' || name === '') return undefined;
  if (typeof root !== 'string' || !isAbsolute(root)) return undefined;
  if (typeof mtime !== 'number' || !Number.isFinite(mtime) || mtime < 0) return undefined;
  return { path, name, mtime, root };
};

export const indexConfigKey = (config: Config): string =>
  JSON.stringify({ roots: config.roots, ignore: config.ignore });

export const emptyIndex = (): DirIndex => ({
  version: INDEX_VERSION,
  generatedAt: 0,
  configKey: '',
  entries: [],
});

export const loadIndex = (): DirIndex => {
  const file = indexFile();
  if (!existsSync(file)) return emptyIndex();
  const parsed = tryReadJson(file);
  if (!isRecord(parsed) || !Array.isArray(parsed['entries'])) return emptyIndex();
  const generatedAt = parsed['generatedAt'];
  const configKey = parsed['configKey'];
  return {
    version: INDEX_VERSION,
    generatedAt:
      typeof generatedAt === 'number' && Number.isFinite(generatedAt) && generatedAt >= 0
        ? generatedAt
        : 0,
    configKey: typeof configKey === 'string' ? configKey : '',
    entries: parsed['entries'].map(readEntry).filter((e): e is IndexEntry => e !== undefined),
  };
};

export const saveIndex = (index: DirIndex): void => {
  writeAtomic(indexFile(), `${JSON.stringify(index)}\n`);
};

export const isStale = (index: DirIndex, now: number): boolean =>
  index.generatedAt > now || now - index.generatedAt > INDEX_TTL_MS;

export const matchesConfig = (index: DirIndex, config: Config): boolean =>
  index.configKey === indexConfigKey(config);

const shouldSkip = (name: string, ignore: readonly string[]): boolean =>
  name.startsWith(HIDDEN_PREFIX) || ignore.includes(name);

interface WalkState {
  readonly entries: IndexEntry[];
  readonly seen: Set<string>;
  readonly deadline: number;
  readonly ignore: readonly string[];
}

const canonical = (dir: string): string | undefined => {
  try {
    return realpathSync(dir);
  } catch {
    return undefined;
  }
};

const mtimeOf = (dir: string): number => {
  try {
    return statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
};

const isDirectoryPath = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** A symlink only counts when it points at a directory, so linked files never enter the index. */
const listDirs = (dir: string, ignore: readonly string[]): string[] => {
  let entries: { name: string; link: boolean }[];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => ({ name: d.name, link: d.isSymbolicLink() }));
  } catch {
    return [];
  }
  return entries
    .filter((entry) => !shouldSkip(entry.name, ignore))
    .map((entry) => ({ path: join(dir, entry.name), link: entry.link }))
    .filter((entry) => !entry.link || isDirectoryPath(entry.path))
    .map((entry) => entry.path);
};

const walk = (dir: string, depth: number, root: RootConfig, state: WalkState): void => {
  if (depth > root.depth) return;
  if (state.entries.length >= MAX_ENTRIES || Date.now() > state.deadline) return;
  for (const child of listDirs(dir, state.ignore)) {
    if (state.entries.length >= MAX_ENTRIES || Date.now() > state.deadline) return;
    const real = canonical(child);
    if (real === undefined || state.seen.has(real)) continue;
    state.seen.add(real);
    state.entries.push({ path: child, name: basename(child), mtime: mtimeOf(child), root: root.path });
    walk(child, depth + 1, root, state);
  }
};

export const buildIndex = (config: Config, now: number = Date.now()): DirIndex => {
  const state: WalkState = {
    entries: [],
    seen: new Set(),
    deadline: Date.now() + MAX_WALK_MS,
    ignore: config.ignore,
  };
  for (const root of config.roots) {
    if (!existsSync(root.path)) continue;
    const real = canonical(root.path);
    if (real !== undefined) state.seen.add(real);
    walk(root.path, 1, root, state);
  }
  return {
    version: INDEX_VERSION,
    generatedAt: now,
    configKey: indexConfigKey(config),
    entries: state.entries,
  };
};

export const refreshIndex = (config: Config, now: number = Date.now()): DirIndex => {
  const index = buildIndex(config, now);
  saveIndex(index);
  return index;
};

/** Direct children of `path` that are present in the index. */
export const childrenOf = (index: DirIndex, path: string): IndexEntry[] => {
  const prefix = `${path}/`;
  return index.entries.filter(
    (e) => e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes('/'),
  );
};
