import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tryReadJson } from '../json.js';
import { indexFile, isProtocolSafePath, isUnder, writeAtomic } from '../paths.js';
import type { Config, RootConfig } from '../config.js';
import { withStateLock } from './lock.js';
import { parseIndex } from './index-schema.js';

const INDEX_VERSION = 3;
export const INDEX_TTL_MS = 60 * 60 * 1000;
export const MAX_ENTRIES = 50_000;
export const MAX_WALK_MS = 5000;
const HIDDEN_PREFIX = '.';

export interface IndexEntry {
  readonly path: string;
  readonly name: string;
  readonly mtime: number;
  readonly root: string;
  readonly realPath: string;
}

export type TruncationReason = 'entries' | 'time';

export interface DirIndex {
  readonly version: number;
  readonly generatedAt: number;
  readonly configKey: string;
  readonly truncated: TruncationReason | null;
  readonly entries: readonly IndexEntry[];
}

export const indexConfigKey = (config: Config): string =>
  JSON.stringify({ roots: config.roots, ignore: config.ignore });

export const emptyIndex = (): DirIndex => ({
  version: INDEX_VERSION,
  generatedAt: 0,
  configKey: '',
  truncated: null,
  entries: [],
});

export const loadIndex = (): DirIndex => {
  const file = indexFile();
  if (!existsSync(file)) return emptyIndex();
  const loaded = parseIndex(tryReadJson(file), INDEX_VERSION);
  if (loaded === undefined) return emptyIndex();
  if (loaded.migrated) {
    try {
      saveIndex(loaded.index);
    } catch {
      // The migrated cache remains usable if another process is already updating it.
    }
  }
  return loaded.index;
};

export const saveIndex = (index: DirIndex): void => {
  withStateLock(indexFile(), () => writeAtomic(indexFile(), `${JSON.stringify(index)}\n`));
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
  readonly maxEntries: number;
  canonicalRoot: string;
  truncated: TruncationReason | null;
}

export interface IndexLimits {
  readonly maxEntries: number;
  readonly maxWalkMs: number;
}

const DEFAULT_LIMITS: IndexLimits = { maxEntries: MAX_ENTRIES, maxWalkMs: MAX_WALK_MS };

const shouldStop = (state: WalkState): boolean => {
  if (state.entries.length >= state.maxEntries) {
    state.truncated = 'entries';
    return true;
  }
  if (Date.now() > state.deadline) {
    state.truncated = 'time';
    return true;
  }
  return false;
};

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
  if (shouldStop(state)) return;
  for (const child of listDirs(dir, state.ignore)) {
    if (shouldStop(state)) return;
    const real = canonical(child);
    if (
      real === undefined || !isUnder(real, state.canonicalRoot)
      || !isProtocolSafePath(child) || !isProtocolSafePath(real) || state.seen.has(real)
    ) continue;
    state.seen.add(real);
    state.entries.push({ path: child, name: basename(child), mtime: mtimeOf(child), root: root.path, realPath: real });
    walk(child, depth + 1, root, state);
  }
};

export const buildIndex = (
  config: Config,
  now: number = Date.now(),
  limits: IndexLimits = DEFAULT_LIMITS,
): DirIndex => {
  const state: WalkState = {
    entries: [],
    seen: new Set(),
    deadline: Date.now() + limits.maxWalkMs,
    ignore: config.ignore,
    maxEntries: Math.max(1, limits.maxEntries),
    canonicalRoot: '',
    truncated: null,
  };
  for (const root of config.roots) {
    if (!existsSync(root.path)) continue;
    const real = canonical(root.path);
    if (real === undefined) continue;
    state.canonicalRoot = real;
    state.seen.add(real);
    walk(root.path, 1, root, state);
  }
  return {
    version: INDEX_VERSION,
    generatedAt: now,
    configKey: indexConfigKey(config),
    truncated: state.truncated,
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
