import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { isProtocolSafePath } from '../paths.js';
import type { VisitRecord } from './frecency.js';

export const MAX_DB_RECORDS = 10_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const readVisitRecord = (value: unknown): VisitRecord | undefined => {
  if (!isRecord(value)) return undefined;
  const { path, realPath, visits, lastVisit } = value;
  if (typeof path !== 'string' || !isAbsolute(path) || !isProtocolSafePath(path)) return undefined;
  if (realPath !== undefined && (
    typeof realPath !== 'string' || !isAbsolute(realPath) || !isProtocolSafePath(realPath)
  )) return undefined;
  if (typeof visits !== 'number' || !Number.isFinite(visits) || visits <= 0) return undefined;
  if (typeof lastVisit !== 'number' || !Number.isFinite(lastVisit) || lastVisit < 0) return undefined;
  const record = { path, visits, lastVisit };
  return typeof realPath === 'string' ? { ...record, realPath } : record;
};

export const canonicalPath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

export const boundedRecords = (records: readonly VisitRecord[]): VisitRecord[] =>
  [...records]
    .sort((a, b) => b.lastVisit - a.lastVisit || b.visits - a.visits || a.path.localeCompare(b.path))
    .slice(0, MAX_DB_RECORDS);

export const canonicalRecords = (records: readonly VisitRecord[]): VisitRecord[] => {
  const byPath = new Map<string, VisitRecord>();
  for (const record of records) {
    const realPath = record.realPath ?? canonicalPath(record.path);
    const existing = byPath.get(realPath);
    byPath.set(realPath, {
      path: existing?.path ?? record.path,
      realPath,
      visits: (existing?.visits ?? 0) + record.visits,
      lastVisit: Math.max(existing?.lastVisit ?? 0, record.lastVisit),
    });
  }
  return boundedRecords([...byPath.values()]);
};
