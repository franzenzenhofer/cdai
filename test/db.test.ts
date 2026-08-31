import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingest, loadDb, mergeVisits, parseVisitLines, recordVisit, saveDb } from '../src/store/db.js';
import { AGING_THRESHOLD } from '../src/store/frecency.js';

let dataDir = '';

const appendVisit = (path: string, epoch: number): void => {
  appendFileSync(join(dataDir, 'visits.log'), `${epoch}\t${path}\n`);
};

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cdai-db-'));
  process.env['CDAI_DATA_DIR'] = dataDir;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env['CDAI_DATA_DIR'];
});

describe('parseVisitLines', () => {
  it('reads tab separated epoch and path, keeping spaces', () => {
    const visits = parseVisitLines('1700000000\t/a/b c\n1700000001\t/d\n');
    expect(visits).toEqual([
      { epoch: 1700000000, path: '/a/b c' },
      { epoch: 1700000001, path: '/d' },
    ]);
  });

  it('skips blank and malformed lines instead of failing the run', () => {
    expect(
      parseVisitLines(
        '\nnonsense\n\t/no-epoch\n12junk\t/partial\n-1\t/negative\n1700000000\trelative\n1700000000\t\n',
      ),
    ).toEqual([]);
  });
});

describe('ingest', () => {
  it('turns a visits log into db records and consumes the log', () => {
    appendVisit('/a', 1700000000);
    appendVisit('/a', 1700000100);
    appendVisit('/b', 1700000200);
    const db = ingest();
    expect(db.records).toHaveLength(2);
    const a = db.records.find((r) => r.path === '/a');
    expect(a?.visits).toBe(2);
    expect(a?.lastVisit).toBe(1700000100);
    expect(existsSync(join(dataDir, 'visits.log'))).toBe(false);
    expect(readdirSync(dataDir)).toContain('db.json');
  });

  it('is idempotent when the log is gone', () => {
    appendVisit('/a', 1700000000);
    ingest();
    const second = ingest();
    expect(second.records.find((r) => r.path === '/a')?.visits).toBe(1);
  });

  it('picks up a log left behind by a crashed run', () => {
    writeFileSync(join(dataDir, 'visits.log.ingest.999.1'), '1700000000\t/leftover\n');
    expect(ingest().records.map((r) => r.path)).toContain('/leftover');
    expect(readdirSync(dataDir).filter((f) => f.includes('ingest'))).toHaveLength(0);
  });

  it('does not lose lines appended while ingesting', () => {
    appendVisit('/a', 1700000000);
    ingest();
    appendVisit('/a', 1700000300);
    expect(ingest().records.find((r) => r.path === '/a')?.visits).toBe(2);
  });

  it('survives a corrupt db by ignoring unusable records', () => {
    writeFileSync(
      join(dataDir, 'db.json'),
      JSON.stringify({ records: [{ path: 5 }, { path: 'relative', visits: 1, lastVisit: 1 }, 'junk'] }),
    );
    expect(loadDb().records).toEqual([]);
  });

  it('treats malformed JSON as an empty recoverable cache', () => {
    writeFileSync(join(dataDir, 'db.json'), '{partial');
    expect(loadDb().records).toEqual([]);
  });
});

describe('mergeVisits', () => {
  it('ages the whole db down once the visit budget is blown', () => {
    saveDb({ version: 1, records: [{ path: '/hot', visits: AGING_THRESHOLD, lastVisit: 1 }] });
    const merged = mergeVisits(loadDb(), [{ path: '/hot', epoch: 2 }]);
    expect(merged.records[0]?.visits).toBeCloseTo((AGING_THRESHOLD + 1) * 0.9);
  });
});

describe('recordVisit', () => {
  it('writes through to disk', () => {
    recordVisit('/manual', 1700000000);
    const raw = readFileSync(join(dataDir, 'db.json'), 'utf8');
    expect(raw).toContain('/manual');
  });
});
