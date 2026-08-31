import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeFixture, writeConfig, type Fixture } from './fixtures.js';

const REPO = process.cwd();
const BIN = join(REPO, 'dist', 'cdai.js');
const BASH = '/bin/bash';

let fixture: Fixture;

const runRawBash = (script: string) => {
  const result = spawnSync(BASH, ['--noprofile', '--norc', '-c', script], {
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

const runBash = (body: string) => runRawBash(`eval "$(node ${BIN} init bash)"\n${body}`);

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

describe('cdai in a real Bash', () => {
  it('resolves intent and composes physical-path flags', () => {
    const plain = runBash('cdai petal; pwd');
    expect(plain.status).toBe(0);
    expect(plain.stdout.trim()).toBe(`${fixture.clients}/petalworks`);
    const physical = runBash('cdai -P petal; pwd');
    expect(physical.status).toBe(0);
    expect(physical.stdout.trim()).toBe(realpathSync(`${fixture.clients}/petalworks`));
  });

  it('preserves explicit-path and invalid-option failures', () => {
    const path = runBash('cdai ./definitely-missing; printf "exit=%s\\n" "$?"');
    expect(path.stdout.trim()).toBe('exit=1');
    expect(path.stderr).toContain('definitely-missing');
    expect(path.stderr).not.toContain('no match');
    const option = runBash('cdai -Z petal; printf "exit=%s\\n" "$?"');
    expect(option.stdout.trim()).not.toBe('exit=0');
    expect(option.stderr).not.toContain('thinking');
    const late = runBash('cdai petal -P; printf "exit=%s\\n" "$?"; pwd');
    expect(late.stdout).toContain('exit=1');
    expect(late.stdout.trim().endsWith(fixture.rootDir)).toBe(true);
    const secondPath = runBash('cdai old new/path; printf "exit=%s\\n" "$?"');
    expect(secondPath.stdout).toContain('exit=1');
    expect(secondPath.stderr).not.toContain('no match');
  });

  it('keeps CDPATH behavior native', () => {
    const run = runBash(`CDPATH=${fixture.clients}; cdai petalworks; pwd`);
    expect(run.status).toBe(0);
    expect(run.stdout.trim().endsWith(`${fixture.clients}/petalworks`)).toBe(true);
    expect(run.stderr).toBe('');
  });

  it('completes indexed intent after a native flag and preserves spaces', () => {
    const flagged = runBash(
      'COMP_WORDS=(cdai -P pet); COMP_CWORD=2; __cdai_complete; printf "<%s>\\n" "${COMPREPLY[@]}"',
    );
    expect(flagged.stdout.trim()).toBe('<petalworks>');
    const spaced = runBash(
      'COMP_WORDS=(cdai space); COMP_CWORD=1; __cdai_complete; printf "<%s>\\n" "${COMPREPLY[@]}"',
    );
    expect(spaced.stdout).toContain('<space dir with spaces>');
  });

  it('prioritizes filesystem prefixes and completes hyphen names after --', () => {
    const filesystem = runBash(
      'COMP_WORDS=(cdai de); COMP_CWORD=1; __cdai_complete; printf "<%s>\\n" "${COMPREPLY[@]}"',
    );
    expect(filesystem.stdout.trim()).toBe('<dev>');
    mkdirSync(join(fixture.clients, '-project'));
    const hyphen = runBash(
      '__cdai_run index --refresh >/dev/null 2>&1; COMP_WORDS=(cdai -- -pr); COMP_CWORD=2; __cdai_complete; printf "<%s>\\n" "${COMPREPLY[@]}"',
    );
    expect(hyphen.stdout).toContain('<-project>');
  });

  it('completes setup root values as filesystem directories', () => {
    const run = runBash(
      'COMP_WORDS=(cdai setup --root de); COMP_CWORD=3; __cdai_complete; printf "<%s>\\n" "${COMPREPLY[@]}"',
    );
    expect(run.stdout.trim()).toBe('<dev>');
  });

  it('preserves spaced setup paths and native CDPATH completion', () => {
    const library = join(fixture.rootDir, 'Library');
    mkdirSync(join(library, 'Application Support'), { recursive: true });
    mkdirSync(join(library, 'Application Scripts'), { recursive: true });
    const spaced = runBash(
      `COMP_WORDS=(cdai setup --root '${library}/Application'); COMP_CWORD=3; __cdai_complete; printf '<%s>\\n' "\${COMPREPLY[@]}"`,
    );
    expect(new Set(spaced.stdout.trim().split('\n'))).toEqual(new Set([
      `<${library}/Application Scripts>`, `<${library}/Application Support>`,
    ]));
    const base = join(fixture.rootDir, 'CD Path');
    mkdirSync(join(base, 'hinterland'), { recursive: true });
    const cdpath = runBash(
      `CDPATH='${base}'; COMP_WORDS=(cdai hin); COMP_CWORD=1; __cdai_complete; printf '<%s>\\n' "\${COMPREPLY[@]}"`,
    );
    expect(cdpath.stdout).toContain('<hinterland>');
  });

  it('advertises only cd flags supported by the running Bash', () => {
    const run = runBash('printf "%s\\n" "$_CDAI_BASH_CD_OPTIONS"');
    const help = runRawBash('help cd').stdout;
    expect(run.stdout).toContain('-L -P');
    expect(run.stdout.includes('-e')).toBe(help.includes('-e'));
    expect(run.stdout.includes('-@')).toBe(help.includes('-@'));
  });

  it('preserves the previous status for scalar and array prompt callbacks', () => {
    const scalar = runRawBash(
      `PROMPT_COMMAND='printf "scalar=%s\\n" "$?"'\neval "$(node ${BIN} init bash)"\n__CDAI_LAST=$PWD\nfalse\neval "$PROMPT_COMMAND"`,
    );
    expect(scalar.stdout).toContain('scalar=1');
    const array = runRawBash(
      `PROMPT_COMMAND=('printf "array=%s\\n" "$?"')\neval "$(node ${BIN} init bash)"\n__CDAI_LAST=$PWD\nfalse\nfor command in "${'${PROMPT_COMMAND[@]}'}"; do eval "$command"; done`,
    );
    expect(array.stdout).toContain('array=1');
  });

  it('lets an existing reserved-name directory win natively', () => {
    mkdirSync(join(fixture.projects, 'doctor'));
    const run = runBash(`cd ${fixture.projects}; cdai doctor; pwd`);
    expect(run.stdout.trim()).toBe(join(fixture.projects, 'doctor'));
    expect(run.stderr).toBe('');
  });
});
