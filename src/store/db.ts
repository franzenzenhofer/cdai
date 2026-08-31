import { existsSync } from 'node:fs';
import { tryReadJson } from '../json.js';
import { dbFile, writeAtomic } from '../paths.js';
import { applyAging, needsAging, type VisitRecord } from './frecency.js';
import { withStateLock } from './lock.js';
import { boundedRecords, canonicalPath, canonicalRecords, readVisitRecord } from './db-records.js';
import {
  claimLogs,
  legacyClaimOffsets,
  readClaimBatch,
  readClaimOffsets,
  retireSettledClaims,
  type ClaimOffsets,
  type Visit,
} from './visit-claims.js';
export { parseVisitLines, type Visit } from './visit-claims.js';
export { MAX_DB_RECORDS } from './db-records.js';

const DB_VERSION = 3;
const LEGACY_DB_VERSION = 1;
const PREVIOUS_DB_VERSION = 2;
const VISIT_INCREMENT = 1;

export interface Db {
  readonly version: number;
  readonly records: readonly VisitRecord[];
  /** Byte offsets durably applied from pending logs; prevents loss and replay around shell appends. */
  readonly claimOffsets: ClaimOffsets;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const emptyDb = (): Db => ({ version: DB_VERSION, records: [], claimOffsets: {} });

interface DbState {
  readonly db: Db;
  readonly migrated: boolean;
}

const loadDbState = (): DbState => {
  const file = dbFile();
  if (!existsSync(file)) return { db: emptyDb(), migrated: false };
  const parsed = tryReadJson(file);
  if (!isRecord(parsed) || !Array.isArray(parsed['records'])) return { db: emptyDb(), migrated: false };
  const version = parsed['version'];
  if (version !== LEGACY_DB_VERSION && version !== PREVIOUS_DB_VERSION && version !== DB_VERSION) {
    if (typeof version === 'number') throw new Error(`unsupported db schema version ${String(version)}; state was not modified`);
    return { db: emptyDb(), migrated: false };
  }
  const rawRecords = parsed['records']
    .map(readVisitRecord)
    .filter((r): r is VisitRecord => r !== undefined);
  const records = canonicalRecords(rawRecords);
  return {
    db: {
      version: DB_VERSION,
      records,
      claimOffsets: version === DB_VERSION
        ? readClaimOffsets(parsed['claimOffsets'])
        : legacyClaimOffsets(parsed['appliedClaims']),
    },
    migrated: version !== DB_VERSION
      || rawRecords.some((record) => record.realPath === undefined)
      || records.length !== rawRecords.length,
  };
};

export const loadDb = (): Db => loadDbState().db;

const saveDbUnlocked = (db: Db): void => {
  writeAtomic(
    dbFile(),
    `${JSON.stringify({
      version: DB_VERSION,
      records: canonicalRecords(db.records),
      claimOffsets: db.claimOffsets,
    })}\n`,
  );
};

export const saveDb = (db: Db): void => withStateLock(dbFile(), () => saveDbUnlocked(db));

export const mergeVisits = (db: Db, visits: readonly Visit[]): Db => {
  const byPath = new Map<string, VisitRecord>(canonicalRecords(db.records).map((r) => [r.realPath ?? r.path, r]));
  const canonical = new Map<string, string>();
  for (const visit of visits) {
    let realPath = canonical.get(visit.path);
    if (realPath === undefined) {
      realPath = canonicalPath(visit.path);
      canonical.set(visit.path, realPath);
    }
    const existing = byPath.get(realPath);
    byPath.set(realPath, {
      path: existing?.path ?? visit.path,
      realPath,
      visits: (existing?.visits ?? 0) + VISIT_INCREMENT,
      lastVisit: Math.max(existing?.lastVisit ?? 0, visit.epoch),
    });
  }
  const records = boundedRecords([...byPath.values()]);
  return {
    version: DB_VERSION,
    records: needsAging(records) ? applyAging(records) : records,
    claimOffsets: db.claimOffsets,
  };
};

const ingestLocked = (): Db => {
  const logs = claimLogs();
  const loaded = loadDbState();
  let db = loaded.db;
  if (logs.length === 0) {
    if (loaded.migrated) saveDbUnlocked(db);
    return db;
  }
  const batch = readClaimBatch(logs, db.claimOffsets);
  const merged = mergeVisits(db, batch.visits);
  db = { ...merged, claimOffsets: batch.offsets };
  // Applied byte offsets and merged records land together before any settled log is retired.
  saveDbUnlocked(db);
  const offsets = retireSettledClaims(logs, batch);
  const cleaned = { ...db, claimOffsets: offsets };
  if (Object.keys(offsets).length !== Object.keys(db.claimOffsets).length) saveDbUnlocked(cleaned);
  return cleaned;
};

/** Serializes claim -> merge -> durable save -> retire, so parallel queries cannot lose visits. */
export const ingest = (): Db => withStateLock(dbFile(), ingestLocked);

export const recordVisit = (path: string, epoch: number): Db => {
  return withStateLock(dbFile(), () => {
    const merged = mergeVisits(ingestLocked(), [{ path, epoch }]);
    saveDbUnlocked(merged);
    return merged;
  });
};

export const updateDb = (update: (db: Db) => Db): Db =>
  withStateLock(dbFile(), () => {
    const next = update(ingestLocked());
    saveDbUnlocked(next);
    return next;
  });
