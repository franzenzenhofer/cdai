import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeFixture, writeConfig, type Fixture } from './fixtures.js';

const REPO = process.cwd();
const BIN = join(REPO, 'dist', 'cdai.js');
const BASH = '/bin/bash';

let fixture: Fixture;

const runBash = (body: string) => {
  const script = `eval "$(node ${BIN} init bash)"\n${body}`;
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
});
