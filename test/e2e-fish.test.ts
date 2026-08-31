import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveExecutable } from '../src/executable.js';
import { makeFixture, writeConfig, type Fixture } from './fixtures.js';

const REPO = process.cwd();
const BIN = join(REPO, 'dist', 'cdai.js');
const FISH = resolveExecutable('fish');

let fixture: Fixture;

const runFish = (body: string) => {
  const script = `node ${BIN} init fish | source\n${body}`;
  const result = spawnSync(FISH ?? 'fish', ['--no-config', '--command', script], {
    encoding: 'utf8',
    cwd: fixture.rootDir,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: fixture.rootDir,
      CDAI_CONFIG_DIR: fixture.configDir,
      CDAI_DATA_DIR: fixture.dataDir,
      CDAI_BIN: `node ${BIN}`,
    },
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
};

beforeAll(() => {
  expect(spawnSync('node', [join(REPO, 'scripts', 'build.mjs')]).status).toBe(0);
});

beforeEach(() => {
  fixture = makeFixture();
  writeConfig(fixture);
  const indexed = spawnSync('node', [BIN, 'index', '--refresh'], {
    env: { ...process.env, CDAI_CONFIG_DIR: fixture.configDir, CDAI_DATA_DIR: fixture.dataDir },
  });
  expect(indexed.status).toBe(0);
});

afterEach(() => {
  fixture.cleanup();
});

describe.skipIf(FISH === null)('cdai in a real fish', () => {
  it('resolves plain and option-terminated indexed intent', () => {
    expect(runFish('cdai petal; pwd').stdout.trim()).toBe(`${fixture.clients}/petalworks`);
    expect(runFish('cdai -- petal; pwd').stdout.trim()).toBe(`${fixture.clients}/petalworks`);
  });

  it('keeps explicit missing paths native-only', () => {
    const run = runFish('cdai ./definitely-missing; echo exit=$status');
    expect(run.stdout.trim()).toBe('exit=1');
    expect(run.stderr).toContain('definitely-missing');
    expect(run.stderr).not.toContain('no match');
  });

  it('offers indexed names through fish completion', () => {
    const run = runFish("complete -C 'cdai pet'");
    expect(run.stdout).toContain('petalworks');
  });
});
