import { spawnSync } from 'node:child_process';
import { chmodSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CLI_CONTROLS } from '../src/shell/control.js';
import { makeFixture, type Fixture } from './fixtures.js';

const REPO = process.cwd();
const BIN = join(REPO, 'dist', 'cdai.js');
const SHELLS = [
  { name: 'zsh', bin: '/bin/zsh', args: ['-f', '-c'] },
  { name: 'bash', bin: '/bin/bash', args: ['--noprofile', '--norc', '-c'] },
] as const;

type CliControl = (typeof CLI_CONTROLS)[number];

const CONTROL_ARGS: Record<CliControl, readonly string[]> = {
  init: ['init', 'zsh'],
  setup: ['setup', '--yes'],
  index: ['index', '--refresh'],
  import: ['import', 'zoxide'],
  doctor: ['doctor'],
  query: ['query', '--', 'petal'],
  complete: ['complete', '--', 'pet'],
  '--help': ['--help'],
  '-h': ['-h'],
  '--version': ['--version'],
  '-v': ['-v'],
};

let fixture: Fixture;

beforeAll(() => {
  expect(spawnSync('node', [join(REPO, 'scripts', 'build.mjs')]).status).toBe(0);
});

beforeEach(() => {
  fixture = makeFixture();
});

afterEach(() => {
  fixture.cleanup();
});

describe('shell management command routing', () => {
  it.each(SHELLS)('routes every CLI control in $name', (shell) => {
    const shim = join(fixture.rootDir, 'cdai-router');
    writeFileSync(shim, '#!/bin/sh\nprintf "%s\\n" "$*"\n');
    chmodSync(shim, 0o755);
    const calls = CLI_CONTROLS.map((control) => CONTROL_ARGS[control].join(' '));
    const commands = calls.map((args) => `cdai ${args}`).join('\n');
    const script = `eval "$(node ${BIN} init ${shell.name})"\n${commands}\npwd`;
    const result = spawnSync(shell.bin, [...shell.args, script], {
      cwd: fixture.rootDir,
      encoding: 'utf8',
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: fixture.rootDir,
        CDAI_BIN: shim,
        CDAI_DATA_DIR: fixture.dataDir,
      },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().split('\n')).toEqual([...calls, realpathSync(fixture.rootDir)]);
  });
});
