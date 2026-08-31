import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeFixture, writeConfig, type Fixture } from './fixtures.js';
import { completeQuery } from '../src/commands/complete.js';
import { emptyDb } from '../src/store/db.js';
import type { DirIndex, IndexEntry } from '../src/store/indexer.js';

const REPO = process.cwd();
const BIN = join(REPO, 'dist', 'cdai.js');
/** Median stays imperceptible; p95 absorbs CI scheduling without allowing a slow hot path. */
const MEDIAN_BUDGET_MS = 150;
const P95_BUDGET_MS = 250;
const RUNS = 10;
const LARGE_INDEX_ENTRIES = 50_000;
const LARGE_CORE_BUDGET_MS = 250;

let fixture: Fixture;

const query = (...args: string[]): { status: number; stdout: string; ms: number } => {
  const started = Date.now();
  const result = spawnSync('node', [BIN, 'query', '--', ...args], {
    encoding: 'utf8',
    cwd: fixture.rootDir,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: fixture.rootDir,
      CDAI_CONFIG_DIR: fixture.configDir,
      CDAI_DATA_DIR: fixture.dataDir,
    },
  });
  return { status: result.status ?? -1, stdout: result.stdout, ms: Date.now() - started };
};

const percentile = (values: readonly number[], share: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * share) - 1)] ?? Number.POSITIVE_INFINITY;
};

const expectFast = (timings: readonly number[]): void => {
  expect(percentile(timings, 0.5)).toBeLessThan(MEDIAN_BUDGET_MS);
  expect(percentile(timings, 0.95)).toBeLessThan(P95_BUDGET_MS);
};

/** Core matching is synchronous; CPU time measures its work without counting CI descheduling. */
const elapsedCpuMs = (started: ReturnType<typeof process.cpuUsage>): number => {
  const elapsed = process.cpuUsage(started);
  return (elapsed.user + elapsed.system) / 1000;
};

beforeAll(() => {
  expect(spawnSync('node', [join(REPO, 'scripts', 'build.mjs')], { encoding: 'utf8' }).status).toBe(0);
});

beforeEach(() => {
  fixture = makeFixture();
  writeConfig(fixture);
  expect(spawnSync('node', [BIN, 'index', '--refresh'], {
    encoding: 'utf8',
    env: {
      PATH: process.env['PATH'] ?? '',
      CDAI_CONFIG_DIR: fixture.configDir,
      CDAI_DATA_DIR: fixture.dataDir,
    },
  }).status).toBe(0);
});

afterEach(() => {
  fixture.cleanup();
});

describe('latency', () => {
  it('keeps exact-hit median and p95 latency bounded', () => {
    const timings: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const run = query('almanac');
      expect(run.status).toBe(0);
      expect(run.stdout.trim()).toBe(`${fixture.projects}/almanac`);
      timings.push(run.ms);
    }
    expectFast(timings);
  });

  it('keeps cached Tab-completion median and p95 latency bounded', () => {
    const timings: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const started = Date.now();
      const run = spawnSync('node', [BIN, 'complete', '--', 'asa'], {
        encoding: 'utf8',
        cwd: fixture.rootDir,
        env: {
          PATH: process.env['PATH'] ?? '',
          HOME: fixture.rootDir,
          CDAI_CONFIG_DIR: fixture.configDir,
          CDAI_DATA_DIR: fixture.dataDir,
        },
      });
      expect(run.status).toBe(0);
      expect(run.stdout).toBe('almanac\n');
      timings.push(Date.now() - started);
    }
    expectFast(timings);
  });

  it('prints the path and nothing else on stdout', () => {
    const run = query('almanac');
    expect(run.stdout).toBe(`${fixture.projects}/almanac\n`);
  });

  it('keeps worst-case typo completion bounded at the maximum index size', () => {
    const path = join(fixture.projects, 'goalmap');
    const entries: IndexEntry[] = Array.from({ length: LARGE_INDEX_ENTRIES }, (_, index) => ({
      path,
      name: `abcedfgh-${index}`,
      mtime: 0,
      root: fixture.projects,
      realPath: `/synthetic/${index}`,
    }));
    const index: DirIndex = {
      version: 3, generatedAt: Date.now(), configKey: '', truncated: null, entries,
    };
    const started = process.cpuUsage();
    expect(completeQuery(['abcdefgh'], {
      index, db: emptyDb(), cwd: fixture.rootDir, nowSeconds: Math.floor(Date.now() / 1000),
    })).toHaveLength(1);
    expect(elapsedCpuMs(started)).toBeLessThan(LARGE_CORE_BUDGET_MS);
  });
});
