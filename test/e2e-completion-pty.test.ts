import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveExecutable } from '../src/executable.js';
import { makeFixture, writeConfig, type Fixture } from './fixtures.js';

const REPO = process.cwd();
const BIN = join(REPO, 'dist', 'cdai.js');
const EXPECT = resolveExecutable('expect');
const FISH = resolveExecutable('fish');
let fixture: Fixture;

type InteractiveShell = 'zsh' | 'bash' | 'fish';

const expectScript = (shell: InteractiveShell, command: string, expected: string): string => {
  const shellArgs = shell === 'zsh'
    ? '/bin/zsh -f'
    : shell === 'bash' ? '/bin/bash --noprofile --norc' : `${FISH ?? 'fish'} --no-config`;
  const initFile = join(fixture.rootDir, `init.${shell}`);
  const setup = shell === 'fish'
    ? `function fish_prompt; echo -n 'PROMPT> '; end; source ${initFile}`
    : `PS1='PROMPT> '; source ${initFile}`;
  const initialPrompt = shell === 'fish' ? 'expect -re {> }' : 'expect -re {[$%#] }';
  const terminal = shell === 'fish' ? 'dumb' : 'xterm-256color';
  return [
    'set timeout 10',
    `spawn env TERM=${terminal} HOME=$env(HOME) CDAI_CONFIG_DIR=$env(CDAI_CONFIG_DIR) CDAI_DATA_DIR=$env(CDAI_DATA_DIR) CDAI_BIN=$env(CDAI_BIN) ${shellArgs}`,
    'expect_before timeout { exit 124 }',
    initialPrompt,
    `send -- "${setup}\\r"`,
    'expect "PROMPT> "',
    `send -- "${command}\\t\\r"`,
    'expect "PROMPT> "',
    'send -- "pwd\\r"',
    `expect "${expected}"`,
    'expect "PROMPT> "',
    'send -- "exit\\r"',
    'expect eof',
  ].join('\n');
};

const runPty = (shell: InteractiveShell, command: string, expected: string) =>
  spawnSync(EXPECT ?? 'expect', ['-c', expectScript(shell, command, expected)], {
    encoding: 'utf8',
    cwd: fixture.rootDir,
    env: {
      ...process.env,
      HOME: fixture.rootDir,
      CDAI_CONFIG_DIR: fixture.configDir,
      CDAI_DATA_DIR: fixture.dataDir,
      CDAI_BIN: `node ${BIN}`,
    },
  });

beforeAll(() => {
  expect(EXPECT).not.toBeNull();
  expect(spawnSync('node', [join(REPO, 'scripts', 'build.mjs')]).status).toBe(0);
});

beforeEach(() => {
  fixture = makeFixture();
  writeConfig(fixture);
  const shells: InteractiveShell[] = ['zsh', 'bash'];
  if (FISH !== null) shells.push('fish');
  for (const shell of shells) {
    const init = spawnSync('node', [BIN, 'init', shell], {
      encoding: 'utf8',
      env: { ...process.env, CDAI_DATA_DIR: fixture.dataDir },
    });
    writeFileSync(join(fixture.rootDir, `init.${shell}`), init.stdout);
  }
  expect(spawnSync('node', [BIN, 'index', '--refresh'], {
    env: { ...process.env, CDAI_CONFIG_DIR: fixture.configDir, CDAI_DATA_DIR: fixture.dataDir },
  }).status).toBe(0);
});

afterEach(() => fixture.cleanup());

describe('real interactive Tab completion', () => {
  it('zsh completes indexed intent without deleting the token', () => {
    const result = runPty('zsh', 'cdai pet', join(fixture.clients, 'petalworks'));
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it('Bash prioritizes an exact filesystem directory prefix', () => {
    const result = runPty('bash', 'cdai de', fixture.projects);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it.skipIf(FISH === null)('Fish completes indexed intent on Tab', () => {
    const result = runPty('fish', 'cdai pet', join(fixture.clients, 'petalworks'));
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  for (const shell of ['zsh', 'bash'] as const) {
    it(`${shell} completes compact and typo intent on Tab`, () => {
      const compact = runPty(shell, 'cdai gma', join(fixture.projects, 'goalmap'));
      expect(compact.status, compact.stdout + compact.stderr).toBe(0);
      const typo = runPty(shell, 'cdai petla', join(fixture.clients, 'petalworks'));
      expect(typo.status, typo.stdout + typo.stderr).toBe(0);
    });

    it(`${shell} leaves an unrelated token intact`, () => {
      const result = runPty(shell, `cd ${fixture.projects}; cdai zzqx`, fixture.projects);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      const ambiguous = runPty(shell, `cd ${fixture.projects}; cdai srr`, fixture.projects);
      expect(ambiguous.status, ambiguous.stdout + ambiguous.stderr).toBe(0);
    });
  }

  it.skipIf(FISH === null)('Fish completes compact and typo intent on Tab', () => {
    const compact = runPty('fish', 'cdai gma', join(fixture.projects, 'goalmap'));
    expect(compact.status, compact.stdout + compact.stderr).toBe(0);
    const typo = runPty('fish', 'cdai petla', join(fixture.clients, 'petalworks'));
    expect(typo.status, typo.stdout + typo.stderr).toBe(0);
  });

  it.skipIf(FISH === null)('Fish leaves an unrelated token intact', () => {
    const result = runPty('fish', `cd ${fixture.projects}; cdai zzqx`, fixture.projects);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const ambiguous = runPty('fish', `cd ${fixture.projects}; cdai srr`, fixture.projects);
    expect(ambiguous.status, ambiguous.stdout + ambiguous.stderr).toBe(0);
  });
});
