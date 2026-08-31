import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeFixture, writeConfig, type Fixture } from './fixtures.js';

const REPO = process.cwd();
const BIN = join(REPO, 'dist', 'cdai.js');
const ZSH = '/bin/zsh';
const EXIT_NO_CD = 3;
const EXIT_ERROR = 1;

let fixture: Fixture;

interface ShellRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const shellEnv = (): Record<string, string> => ({
  PATH: process.env['PATH'] ?? '',
  HOME: fixture.rootDir,
  CDAI_CONFIG_DIR: fixture.configDir,
  CDAI_DATA_DIR: fixture.dataDir,
  CDAI_BIN: `node ${BIN}`,
});

/** Runs a real zsh with no rc files at all, exactly how a user's shell would call cdai. */
const runZsh = (script: string): ShellRun => {
  const result = spawnSync(ZSH, ['-f', '-c', script], {
    encoding: 'utf8',
    cwd: fixture.rootDir,
    env: shellEnv(),
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
};

/** Same, but in its own session, so there is no controlling terminal to ask questions on. */
const runZshHeadless = (script: string): Promise<ShellRun> =>
  new Promise((resolve) => {
    const child = spawn(ZSH, ['-f', '-c', script], {
      cwd: fixture.rootDir,
      env: shellEnv(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('close', (status) => resolve({ status: status ?? -1, stdout, stderr }));
  });

const withInit = (body: string): string => `eval "$(node ${BIN} init zsh)"; ${body}`;

beforeAll(() => {
  const build = spawnSync('node', [join(REPO, 'scripts', 'build.mjs')], { encoding: 'utf8' });
  expect(build.status).toBe(0);
});

beforeEach(() => {
  fixture = makeFixture();
  writeConfig(fixture);
});

afterEach(() => {
  fixture.cleanup();
});

describe('cdai init zsh', () => {
  it('emits shell code only, and it evals cleanly', () => {
    const init = spawnSync('node', [BIN, 'init', 'zsh'], {
      encoding: 'utf8',
      env: { ...process.env, CDAI_DATA_DIR: fixture.dataDir },
    });
    expect(init.status).toBe(0);
    expect(init.stderr).toBe('');
    expect(init.stdout).toContain('add-zsh-hook chpwd __cdai_record');
    expect(init.stdout).toContain('compdef __cdai_complete cdai');
    const evaluated = runZsh(withInit('typeset -f cdai > /dev/null && print ok'));
    expect(evaluated.stdout.trim()).toBe('ok');
  });
});

describe('cdai in a real zsh', () => {
  it('jumps to the matched directory', () => {
    const run = runZsh(withInit('cdai petal; pwd'));
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(`${fixture.clients}/petalworks`);
    expect(run.stderr).toContain('→');
  });

  it('resolves the latest folder of a client', () => {
    const run = runZsh(withInit('cdai latest petalworks folder; pwd'));
    expect(run.stdout.trim()).toBe(`${fixture.clients}/petalworks/petalworks-2026`);
  });

  it('records visits into visits.log through the chpwd hook', () => {
    runZsh(withInit('cdai petal'));
    const log = join(fixture.dataDir, 'visits.log');
    expect(existsSync(log)).toBe(true);
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines[lines.length - 1]).toMatch(new RegExp(`^\\d+\t${fixture.clients}/petalworks$`));
  });

  it('feeds those visits back into the ranking', () => {
    runZsh(withInit(`cd ${fixture.projects}/tabletop-web; cd ${fixture.projects}/tabletop-web`));
    const run = runZsh(withInit('cdai tictac; pwd'));
    expect(run.stdout.trim()).toBe(`${fixture.projects}/tabletop-web`);
  });

  it('behaves like plain cd without arguments', () => {
    const run = runZsh(withInit('cd /tmp; cdai; pwd'));
    expect(run.stdout.trim()).toBe(fixture.rootDir);
  });

  it('treats a single existing directory as a plain cd', () => {
    const run = runZsh(withInit(`cdai ${fixture.projects}/squash; pwd`));
    expect(run.stdout.trim()).toBe(`${fixture.projects}/squash`);
    expect(run.stderr).toBe('');
  });

  it('passes cd options through to the shell builtin', () => {
    const link = `${fixture.projects}/squash-link`;
    const run = runZsh(withInit(`cdai -P ${link}; pwd`));
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(realpathSync(`${fixture.projects}/squash`));
    expect(run.stderr).toBe('');
  });

  it('preserves zsh native old-new directory substitution', () => {
    const start = `${fixture.projects}/tabletop-web`;
    const run = runZsh(withInit(`cd ${start}; cdai web 3d; pwd`));
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(`${fixture.projects}/tabletop-3d`);
    expect(run.stderr).toBe('');
  });

  it('routes management commands to the executable without invoking AI', () => {
    const run = runZsh(
      withInit(
        'cdai doctor; print "doctor=$?"; cdai index --refresh; print "index=$?"; cdai --version; print "version=$?"; pwd',
      ),
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('doctor=0');
    expect(run.stdout).toContain('index=0');
    expect(run.stdout).toContain('version=0');
    expect(run.stdout.trim().endsWith(fixture.rootDir)).toBe(true);
    expect(run.stderr).toContain('cdai doctor');
    expect(run.stderr).toContain('0.2.1');
    expect(run.stderr).not.toContain('thinking');
  });

  it('sends a single dash back to the previous directory like cd does', () => {
    const run = runZsh(withInit(`cd ${fixture.projects}/squash; cd /tmp; cdai -; pwd`));
    expect(run.stdout.trim().endsWith(`${fixture.projects}/squash`)).toBe(true);
  });

  it('handles directories with spaces', () => {
    const run = runZsh(withInit(`cdai space dir with spaces; pwd`));
    expect(run.stdout.trim()).toBe(`${fixture.projects}/space dir with spaces`);
  });

  it('stays put and explains itself when nothing matches', () => {
    const run = runZsh(withInit('cdai nonexistentxyz; print "exit=$?"; pwd'));
    expect(run.stderr).toContain('no match');
    expect(run.stdout).toContain(`exit=${EXIT_ERROR}`);
    expect(run.stdout.trim().endsWith(fixture.rootDir)).toBe(true);
  });

  it('exits with the no-cd code when it cannot ask which one', async () => {
    const run = await runZshHeadless(withInit('cdai tictac; print "exit=$?"; pwd'));
    expect(run.stdout).toContain(`exit=${EXIT_NO_CD}`);
    expect(run.stdout.trim().endsWith(fixture.rootDir)).toBe(true);
    expect(run.stderr).toContain('tabletop-3d');
  });
});
