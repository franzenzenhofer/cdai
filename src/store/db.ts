import { existsSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { tryReadJson } from '../json.js';
import { dataDir, dbFile, visitsLog, writeAtomic, ensureDir } from '../paths.js';
import { applyAging, needsAging, type VisitRecord } from './frecency.js';

const DB_VERSION = 1;
const INGEST_PREFIX = 'visits.log.ingest.';
const FIELD_SEPARATOR = '\t';
const VISIT_INCREMENT = 1;

export interface Db {
  readonly version: number;
  readonly records: readonly VisitRecord[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readVisitRecord = (value: unknown): VisitRecord | undefined => {
  if (!isRecord(value)) return undefined;
  const { path, visits, lastVisit } = value;
  if (typeof path !== 'string' || !isAbsolute(path)) return undefined;
  if (typeof visits !== 'number' || !Number.isFinite(visits) || visits <= 0) return undefined;
  if (typeof lastVisit !== 'number' || !Number.isFinite(lastVisit) || lastVisit < 0) return undefined;
  return { path, visits, lastVisit };
};

export const emptyDb = (): Db => ({ version: DB_VERSION, records: [] });

export const loadDb = (): Db => {
  const file = dbFile();
  if (!existsSync(file)) return emptyDb();
  const parsed = tryReadJson(file);
  if (!isRecord(parsed) || !Array.isArray(parsed['records'])) return emptyDb();
  const records = parsed['records']
    .map(readVisitRecord)
    .filter((r): r is VisitRecord => r !== undefined);
  return { version: DB_VERSION, records };
};

export const saveDb = (db: Db): void => {
  writeAtomic(dbFile(), `${JSON.stringify({ version: DB_VERSION, records: db.records })}\n`);
};

export interface Visit {
  readonly path: string;
  readonly epoch: number;
}

export const parseVisitLines = (contents: string): Visit[] => {
  const visits: Visit[] = [];
  for (const line of contents.split('\n')) {
    if (line === '') continue;
    const tab = line.indexOf(FIELD_SEPARATOR);
    if (tab <= 0) continue;
    const rawEpoch = line.slice(0, tab);
    const epoch = /^\d+$/.test(rawEpoch) ? Number(rawEpoch) : Number.NaN;
    const path = line.slice(tab + 1);
    if (!Number.isSafeInteger(epoch) || epoch <= 0 || !isAbsolute(path)) continue;
    visits.push({ path, epoch });
  }
  return visits;
};

/**
 * Rename-then-ingest: the live log is moved aside under a pid-unique name before it is read,
 * so a shell appending concurrently never loses a line and two cdai runs never double count.
 * Leftovers from a crashed run are picked up on the next call.
 */
const claimLogs = (): string[] => {
  const dir = dataDir();
  ensureDir(dir);
  const live = visitsLog();
  if (existsSync(live)) {
    const claimed = join(dir, `${INGEST_PREFIX}${process.pid}.${Date.now()}`);
    try {
      renameSync(live, claimed);
    } catch {
      return pendingLogs(dir);
    }
  }
  return pendingLogs(dir);
};

const pendingLogs = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.startsWith(INGEST_PREFIX))
    .map((name) => join(dir, name));

export const mergeVisits = (db: Db, visits: readonly Visit[]): Db => {
  const byPath = new Map<string, VisitRecord>(db.records.map((r) => [r.path, r]));
  for (const visit of visits) {
    const existing = byPath.get(visit.path);
    byPath.set(visit.path, {
      path: visit.path,
      visits: (existing?.visits ?? 0) + VISIT_INCREMENT,
      lastVisit: Math.max(existing?.lastVisit ?? 0, visit.epoch),
    });
  }
  const records = [...byPath.values()];
  return { version: DB_VERSION, records: needsAging(records) ? applyAging(records) : records };
};

/** Ingests pending visit logs and returns the up to date db, persisting only when something changed. */
export const ingest = (): Db => {
  const logs = claimLogs();
  const db = loadDb();
  if (logs.length === 0) return db;
  const visits: Visit[] = [];
  for (const log of logs) {
    visits.push(...parseVisitLines(readFileSync(log, 'utf8')));
    rmSync(log, { force: true });
  }
  if (visits.length === 0) return db;
  const merged = mergeVisits(db, visits);
  saveDb(merged);
  return merged;
};

export const recordVisit = (path: string, epoch: number): Db => {
  const merged = mergeVisits(ingest(), [{ path, epoch }]);
  saveDb(merged);
  return merged;
};
