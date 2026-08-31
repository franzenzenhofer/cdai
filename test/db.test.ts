import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyDb, ingest, loadDb, mergeVisits, parseVisitLines, recordVisit, saveDb } from '../src/store/db.js';
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
    const claim = join(dataDir, 'visits.log.ingest.999.1');
    writeFileSync(claim, '1700000000\t/leftover\n');
    expect(ingest().records.map((r) => r.path)).toContain('/leftover');
    const old = new Date(Date.now() - 120_000);
    utimesSync(claim, old, old);
    ingest();
    expect(readdirSync(dataDir).filter((f) => f.includes('ingest'))).toHaveLength(0);
  });

  it('ingests a late append through a descriptor opened before log rotation', () => {
    const fd = openSync(join(dataDir, 'visits.log'), 'a');
    ingest();
    writeSync(fd, '1700000000\t/late-open-writer\n');
    closeSync(fd);
    expect(ingest().records.find((record) => record.path === '/late-open-writer')?.visits).toBe(1);
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

  it('rejects unknown schemas and prevents replay after a post-save crash', () => {
    const future = JSON.stringify({ version: 999, records: [] });
    writeFileSync(join(dataDir, 'db.json'), future);
    expect(() => loadDb()).toThrow('unsupported db schema');
    expect(() => recordVisit('/must-not-overwrite', 1)).toThrow('unsupported db schema');
    expect(readFileSync(join(dataDir, 'db.json'), 'utf8')).toBe(future);
    const claim = 'visits.log.ingest.999.2';
    writeFileSync(join(dataDir, claim), '1700000000\t/already-applied\n');
    writeFileSync(
      join(dataDir, 'db.json'),
      JSON.stringify({
        version: 2,
        records: [{ path: '/already-applied', visits: 1, lastVisit: 1700000000 }],
        appliedClaims: [claim],
      }),
    );
    expect(ingest().records.find((record) => record.path === '/already-applied')?.visits).toBe(1);
    expect(existsSync(join(dataDir, claim))).toBe(true);
  });

  it('keeps claimed visits recoverable when the durable save fails', () => {
    appendVisit('/recoverable', 1700000000);
    mkdirSync(join(dataDir, 'db.json'));
    expect(() => ingest()).toThrow();
    expect(readdirSync(dataDir).some((name) => name.startsWith('visits.log.ingest.'))).toBe(true);
  });
});

describe('mergeVisits', () => {
  it('ages the whole db down once the visit budget is blown', () => {
    saveDb({ ...emptyDb(), records: [{ path: '/hot', visits: AGING_THRESHOLD, lastVisit: 1 }] });
    const merged = mergeVisits(loadDb(), [{ path: '/hot', epoch: 2 }]);
    expect(merged.records[0]?.visits).toBeCloseTo((AGING_THRESHOLD + 1) * 0.9);
  });

  it('deduplicates logical and physical paths by canonical identity', () => {
    const target = join(dataDir, 'target');
    const link = join(dataDir, 'link');
    mkdirSync(target);
    symlinkSync(target, link);
    const merged = mergeVisits(emptyDb(), [
      { path: link, epoch: 1 },
      { path: target, epoch: 2 },
    ]);
    expect(merged.records).toHaveLength(1);
    expect(merged.records[0]?.visits).toBe(2);
  });

  it('canonicalizes and durably merges legacy logical and physical identities', () => {
    const target = join(dataDir, 'legacy-target');
    const link = join(dataDir, 'legacy-link');
    mkdirSync(target);
    symlinkSync(target, link);
    writeFileSync(
      join(dataDir, 'db.json'),
      JSON.stringify({
        version: 1,
        records: [
          { path: link, visits: 2, lastVisit: 1 },
          { path: target, visits: 3, lastVisit: 2 },
        ],
      }),
    );
    const realTarget = realpathSync(target);
    expect(loadDb().records).toMatchObject([{ visits: 5, realPath: realTarget }]);
    expect(ingest().records).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dataDir, 'db.json'), 'utf8'))).toMatchObject({ version: 3 });
    expect(recordVisit(link, 3).records).toMatchObject([{ visits: 6, realPath: realTarget }]);
  });
});

describe('recordVisit', () => {
  it('writes through to disk', () => {
    recordVisit('/manual', 1700000000);
    const raw = readFileSync(join(dataDir, 'db.json'), 'utf8');
    expect(raw).toContain('/manual');
  });
});
