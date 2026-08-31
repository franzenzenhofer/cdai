import { randomUUID } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
} from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { dataDir, ensureDir, isProtocolSafePath, visitsLog } from '../paths.js';

export const INGEST_PREFIX = 'visits.log.ingest.';
const FIELD_SEPARATOR = '\t';
const CLAIM_SETTLE_MS = 60_000;
const MAX_CLAIMS = 10_000;

export interface Visit {
  readonly path: string;
  readonly epoch: number;
}

export type ClaimOffsets = Readonly<Record<string, number>>;

export const parseVisitLines = (contents: string): Visit[] => {
  const visits: Visit[] = [];
  for (const line of contents.split('\n')) {
    if (line === '') continue;
    const tab = line.indexOf(FIELD_SEPARATOR);
    if (tab <= 0) continue;
    const rawEpoch = line.slice(0, tab);
    const epoch = /^\d+$/.test(rawEpoch) ? Number(rawEpoch) : Number.NaN;
    const path = line.slice(tab + 1);
    if (!Number.isSafeInteger(epoch) || epoch <= 0 || !isAbsolute(path) || !isProtocolSafePath(path)) continue;
    visits.push({ path, epoch });
  }
  return visits;
};

const validClaimName = (name: string): boolean =>
  name.startsWith(INGEST_PREFIX) && basename(name) === name;

export const readClaimOffsets = (value: unknown): ClaimOffsets => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([name, offset]) => validClaimName(name) && Number.isSafeInteger(offset) && (offset as number) >= 0)
    .slice(0, MAX_CLAIMS)) as Record<string, number>;
};

export const legacyClaimOffsets = (value: unknown): ClaimOffsets => {
  if (!Array.isArray(value)) return {};
  const offsets: Record<string, number> = {};
  for (const name of value) {
    if (typeof name !== 'string' || !validClaimName(name)) continue;
    try {
      offsets[name] = statSync(join(dataDir(), name)).size;
    } catch {
      offsets[name] = 0;
    }
  }
  return offsets;
};

export const pendingLogs = (): string[] => {
  ensureDir(dataDir());
  return readdirSync(dataDir())
    .filter(validClaimName)
    .map((name) => join(dataDir(), name));
};

export const claimLogs = (): string[] => {
  const live = visitsLog();
  if (existsSync(live)) {
    const claimed = join(dataDir(), `${INGEST_PREFIX}${process.pid}.${Date.now()}.${randomUUID()}`);
    try {
      renameSync(live, claimed);
      const now = new Date();
      utimesSync(claimed, now, now);
    } catch {
      return pendingLogs();
    }
  }
  return pendingLogs();
};

export interface ClaimBatch {
  readonly visits: readonly Visit[];
  readonly offsets: ClaimOffsets;
  readonly changed: ReadonlySet<string>;
}

export const readClaimBatch = (logs: readonly string[], previous: ClaimOffsets): ClaimBatch => {
  const visits: Visit[] = [];
  const offsets: Record<string, number> = { ...previous };
  const changed = new Set<string>();
  for (const log of logs) {
    const name = basename(log);
    const contents = readFileSync(log);
    const start = Math.min(previous[name] ?? 0, contents.length);
    const newline = contents.lastIndexOf(10);
    const end = newline < start ? start : newline + 1;
    if (end > start) {
      visits.push(...parseVisitLines(contents.toString('utf8', start, end)));
      changed.add(name);
    }
    offsets[name] = end;
  }
  return { visits, offsets, changed };
};

export const retireSettledClaims = (
  logs: readonly string[],
  batch: ClaimBatch,
  now: number = Date.now(),
): ClaimOffsets => {
  const offsets = { ...batch.offsets };
  for (const log of logs) {
    const name = basename(log);
    try {
      const stat = statSync(log);
      if (batch.changed.has(name) || batch.offsets[name] !== stat.size || now - stat.mtimeMs < CLAIM_SETTLE_MS) continue;
      const retired = `${log}.trash.${process.pid}.${randomUUID()}`;
      renameSync(log, retired);
      rmSync(retired, { force: true });
      delete offsets[name];
    } catch {
      // A concurrent recovery may already have retired the claim; its durable offset is harmless.
    }
  }
  return offsets;
};
