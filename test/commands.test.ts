import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseZoxideList } from '../src/commands/import-zoxide.js';
import { CLOUD_DEPTH, DEV_DEPTH, HUB_MIN_CHILDREN, detectRoots } from '../src/commands/detect.js';
import { loadConfig } from '../src/config.js';
import { DAY_SECONDS } from '../src/store/frecency.js';
import { makeFixture, writeConfig, type Fixture } from './fixtures.js';

const REPO = process.cwd();
const BIN = join(REPO, 'dist', 'cdai.js');
const EXIT_NO_CD = 3;
const NOW = 1_800_000_000;

let fixture: Fixture;

const runCli = (...args: string[]): { status: number; stdout: string; stderr: string } => {
  const result = spawnSync('node', [BIN, ...args], {
    encoding: 'utf8',
    cwd: fixture.rootDir,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: fixture.rootDir,
      CDAI_CONFIG_DIR: fixture.configDir,
      CDAI_DATA_DIR: fixture.dataDir,
    },
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
};

beforeAll(() => {
  expect(spawnSync('node', [join(REPO, 'scripts', 'build.mjs')], { encoding: 'utf8' }).status).toBe(0);
});

beforeEach(() => {
  fixture = makeFixture();
});

afterEach(() => {
  fixture.cleanup();
});

describe('parseZoxideList', () => {
  it('reads the score and path columns', () => {
    const records = parseZoxideList('  12.5 /a/b\n   1 /c d\nbroken line\n', NOW);
    expect(records).toEqual([
      { path: '/a/b', visits: 13, lastVisit: NOW - DAY_SECONDS },
      { path: '/c d', visits: 1, lastVisit: NOW - DAY_SECONDS },
    ]);
  });
});

describe('detectRoots', () => {
  it('proposes a dev directory at depth 2 and the busiest cloud folder at depth 3', () => {
    const home = fixture.rootDir;
    mkdirSync(join(home, 'dev'), { recursive: true });
    const hub = join(home, 'Acme Dropbox', 'office', 'freelance', 'clients');
    for (let i = 0; i < HUB_MIN_CHILDREN; i += 1) mkdirSync(join(hub, `client-${i}`), { recursive: true });
    const roots = detectRoots(home);
    expect(roots).toContainEqual({ path: join(home, 'dev'), depth: DEV_DEPTH });
    expect(roots).toContainEqual({ path: hub, depth: CLOUD_DEPTH });
  });
});

describe('cli surface', () => {
  it('runs setup non interactively and writes a config', () => {
    mkdirSync(join(fixture.rootDir, 'dev'), { recursive: true });
    const run = runCli('setup', '--yes');
    expect(run.status).toBe(EXIT_NO_CD);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('eval "$(cdai init zsh)"');
    const written: unknown = JSON.parse(readFileSync(join(fixture.configDir, 'config.json'), 'utf8'));
    expect(JSON.stringify(written)).toContain(join(fixture.rootDir, 'dev'));
  });

  it('reports the machine state in doctor', () => {
    writeConfig(fixture);
    const run = runCli('doctor');
    expect(run.status).toBe(EXIT_NO_CD);
    expect(run.stderr).toContain('cdai doctor');
    expect(run.stderr).toContain('roots  2');
  });

  it('shows index statistics per root', () => {
    writeConfig(fixture);
    expect(runCli('index', '--refresh').stderr).toContain('directories in');
    expect(runCli('index').stderr).toContain('depth 3');
  });

  it('honours the config dir override', () => {
    writeConfig(fixture);
    process.env['CDAI_CONFIG_DIR'] = fixture.configDir;
    expect(loadConfig().roots).toHaveLength(2);
    delete process.env['CDAI_CONFIG_DIR'];
  });

  it('fails with usage when there is nothing to search for', () => {
    writeConfig(fixture);
    const run = runCli('query', '--', 'the', 'folder');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('usage');
    expect(run.stdout).toBe('');
  });

  it('refuses to guess without configured roots', () => {
    const run = runCli('query', '--', 'petal');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('cdai setup');
  });
});
