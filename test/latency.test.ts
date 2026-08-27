import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeFixture, writeConfig, type Fixture } from './fixtures.js';

const REPO = process.cwd();
const BIN = join(REPO, 'dist', 'cdai.js');
/** Hard gate: an exact hit must stay well below the point where a shell feels sluggish. */
const BUDGET_MS = 150;
const RUNS = 5;

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
  }).status).toBe(3);
});

afterEach(() => {
  fixture.cleanup();
});

describe('latency', () => {
  it(`answers an exact hit in under ${BUDGET_MS}ms`, () => {
    const timings: number[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const run = query('almanac');
      expect(run.status).toBe(0);
      expect(run.stdout.trim()).toBe(`${fixture.projects}/almanac`);
      timings.push(run.ms);
    }
    const best = Math.min(...timings);
    expect(best).toBeLessThan(BUDGET_MS);
  });

  it('prints the path and nothing else on stdout', () => {
    const run = query('almanac');
    expect(run.stdout).toBe(`${fixture.projects}/almanac\n`);
  });
});
