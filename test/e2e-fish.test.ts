import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
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

  it('preserves cd history, cd -, and CDPATH through the fish wrapper', () => {
    // fish resolves the startup directory, and macOS puts the fixture behind /var -> /private/var.
    const start = realpathSync(fixture.rootDir);
    const history = runFish(`cdai petal; contains -- ${start} $dirprev; echo history=$status`);
    expect(history.stdout).toContain('history=0');
    const previous = runFish(`cd ${fixture.projects}/squash; cd /tmp; cdai -; pwd`);
    expect(previous.stdout.trim()).toBe(`${fixture.projects}/squash`);
    const cdpath = runFish(`set -gx CDPATH ${fixture.clients}; cdai petalworks; pwd`);
    expect(cdpath.stdout.trim()).toBe(`${fixture.clients}/petalworks`);
  });

  it('composes current fish cd flags with indexed intent when supported', () => {
    const run = runFish(
      'if test $_CDAI_FISH_CD_FLAGS -eq 1; for flag in -P --dereference -L --no-dereference; cd '
      + `${fixture.rootDir}; cdai $flag petal; or exit; pwd; end; else; echo unsupported; end`,
    );
    const output = run.stdout.trim().split('\n');
    const logical = `${fixture.clients}/petalworks`;
    // -P and --dereference ask for the physical path, and it differs from the logical one on macOS.
    const physical = realpathSync(logical);
    expect(
      (output.length === 1 && output[0] === 'unsupported')
      || (output.length === 4
        && output.every((path, index) => path === (index < 2 ? physical : logical))),
    ).toBe(true);
  });

  it('takes a pasted URL as intent, in every spelling', () => {
    const target = `${fixture.projects}/arcade/tidewheel`;
    const bare = runFish('cdai https://tidewheel.orbit.dev/level/7; pwd');
    expect(bare.status).toBe(0);
    expect(bare.stdout.trim()).toBe(target);
    const spelled = runFish('cdai the https://tidewheel.orbit.dev/ arcade; pwd');
    expect(spelled.stdout.trim()).toBe(target);
    const quoted = runFish('cdai "the https://tidewheel.orbit.dev/ arcade"; pwd');
    expect(quoted.stdout.trim()).toBe(target);
  });

  it('keeps explicit missing paths native-only', () => {
    const run = runFish('cdai ./definitely-missing; echo exit=$status');
    expect(run.stdout.trim()).toBe('exit=1');
    expect(run.stderr).toContain('definitely-missing');
    expect(run.stderr).not.toContain('no match');
    const later = runFish('cdai petal new/path; echo exit=$status');
    const native = runFish('cd petal new/path; echo exit=$status');
    expect(later.stdout.trim()).toBe(native.stdout.trim());
    expect(later.stdout.trim()).not.toBe('exit=0');
    expect(later.stderr).not.toContain('no match');
  });

  it('offers indexed names through fish completion', () => {
    const run = runFish("complete -C 'cdai pet'");
    expect(run.stdout).toContain('petalworks');
  });

  it('offers compact and typo intent but suppresses ambiguous corrections', () => {
    expect(runFish("complete -C 'cdai gma'").stdout).toContain('goalmap');
    const ambiguous = runFish("complete -C 'cdai srr'").stdout;
    expect(ambiguous).not.toContain('src');
    expect(ambiguous).not.toContain('scripts');
  });

  it('preserves native CDPATH completion outside the index', () => {
    const base = join(fixture.rootDir, 'CD Path');
    mkdirSync(join(base, 'hinterland'), { recursive: true });
    const run = runFish(`set -gx CDPATH '${base}'; complete -C 'cdai hin'`);
    expect(run.stdout).toContain('hinterland');
  });

  it('offers directories and indexed names but never regular files', () => {
    writeFileSync(join(fixture.rootDir, 'dev-file'), 'not a directory');
    const run = runFish("complete -C 'cdai de'");
    expect(run.stdout).toContain('dev');
    expect(run.stdout).not.toContain('dev-file');
  });

  it('completes setup options and root values contextually', () => {
    expect(runFish("complete -C 'cdai setup '").stdout).toContain('--root');
    const root = runFish("complete -C 'cdai setup --root de'");
    expect(root.stdout).toContain('dev');
    expect(root.stdout).not.toContain('--depth');
  });

  it('completes spaces, unicode, duplicate paths, and hyphen names safely', () => {
    mkdirSync(join(fixture.projects, 'shared'));
    mkdirSync(join(fixture.clients, 'shared'));
    mkdirSync(join(fixture.clients, '-project'));
    const run = runFish(
      "__cdai_run index --refresh >/dev/null 2>&1; complete -C 'cdai space'; complete -C 'cdai üni'; complete -C 'cdai sha'; complete -C 'cdai -- -pr'",
    );
    expect(run.stdout).toContain('space dir with spaces');
    expect(run.stdout).toContain('ünicöde-projekt');
    expect(run.stdout).toContain('shared');
    expect(run.stdout).toContain('-project');
  });

  it('routes controls and lets a local reserved-name directory win', () => {
    const controls = runFish('cdai doctor; echo doctor=$status');
    expect(controls.stdout).toContain('doctor=0');
    mkdirSync(join(fixture.projects, 'doctor'));
    const directory = runFish(`cd ${fixture.projects}; cdai doctor; pwd`);
    expect(directory.stdout.trim()).toBe(join(fixture.projects, 'doctor'));
  });
});
