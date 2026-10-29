import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseLearnArgs } from '../src/commands/learn.js';
import { readLearnAnswer } from '../src/learn/answer.js';
import { resolveLearnBackend } from '../src/learn/backend.js';
import { buildDigest, knownPaths, RETRY_WINDOW_MS } from '../src/learn/digest.js';
import { emptyConfig } from '../src/config.js';
import { decisionEntry as entry, makeFixture, writeConfig, type Fixture } from './fixtures.js';
import { BIN, buildBundle } from './cli.js';

const EXECUTABLE = 0o755;

let fixture: Fixture;
let shimDir = '';

const env = (): Record<string, string> => ({
  PATH: `${shimDir}:${process.env['PATH'] ?? ''}`,
  HOME: fixture.rootDir,
  CDAI_CONFIG_DIR: fixture.configDir,
  CDAI_DATA_DIR: fixture.dataDir,
});

const runCli = (...args: string[]) => {
  const result = spawnSync('node', [BIN, ...args], { encoding: 'utf8', cwd: fixture.rootDir, env: env() });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
};

/** The real executable in a real terminal, so its confirmations are asked and answered. */
const runCliWithTty = (input: string, ...args: string[]) => {
  const python = 'import os, pty, sys; raise SystemExit(os.waitstatus_to_exitcode(pty.spawn(sys.argv[1:])))';
  const result = spawnSync('python3', ['-c', python, 'node', BIN, ...args], {
    input, encoding: 'utf8', cwd: fixture.rootDir, env: env(),
  });
  return { status: result.status ?? -1, output: result.stdout };
};

const writeShim = (name: string, body: string): void => {
  const shim = join(shimDir, name);
  writeFileSync(shim, `#!/bin/sh\n${body}\n`);
  chmodSync(shim, EXECUTABLE);
};

const answerJson = (aliases: readonly object[]): string => JSON.stringify({
  summary: 'Mostly clean hits.',
  aliases,
  settings: [{ command: 'cdai setup --root ~/work --yes', why: 'misses outside the roots' }, { command: 'rm -rf ~', why: 'x' }],
  improvements: [{ title: 'Read "flower" as petal', evidence: 'the flower client missed', proposal: 'synonyms' }],
});

/** Claude Code's print-mode envelope, with the arguments it was called with kept for the test. */
const claudeShim = (answer: string): void => {
  const envelope = JSON.stringify({ type: 'result', structured_output: JSON.parse(answer) as unknown });
  writeFileSync(join(shimDir, 'envelope.json'), envelope);
  writeShim('claude', `printf '%s\\n' "$@" > '${join(shimDir, 'args.txt')}'\ncat '${join(shimDir, 'envelope.json')}'`);
};

const logDecisions = (): void => {
  writeConfig(fixture);
  runCli('petalworks');
  runCli('the flower client');
  runCli('petal');
};

beforeAll(() => {
  expect(buildBundle()).toBe(0);
});

beforeEach(() => {
  fixture = makeFixture();
  shimDir = join(fixture.rootDir, 'bin');
  mkdirSync(shimDir);
});

afterEach(() => {
  fixture.cleanup();
});

describe('the digest', () => {
  it('keeps what can teach something and marks a retry only when it is one', () => {
    const at = 1_800_000_000_000;
    const entries = [
      entry({ at, words: ['petal'] }),
      entry({ at: at + 1000, words: ['petal', '2025'], path: '/p/petalworks-2025' }),
      entry({ at: at + 2000, words: ['goalmap'], path: '/p/goalmap' }),
      entry({ at: at + 3000, words: ['flower', 'client'], outcome: 'miss', via: 'none', path: null }),
      entry({ at: at + 3000 + RETRY_WINDOW_MS + 1, words: ['zenith'], path: '/p/zenith' }),
    ];
    const digest = buildDigest(entries, emptyConfig(), []);
    expect(digest.episodes.map((e) => e.words)).toEqual(['petal', 'flower client']);
    expect(digest.episodes[0]?.then).toMatchObject({ words: 'petal 2025', afterSeconds: 1 });
    expect(digest.episodes[1]?.then).toBeNull();
    expect(digest.totals).toMatchObject({ decisions: 5, 'outcome.miss': 1, retriedWithin2Min: 1 });
    expect(digest.targets[0]).toMatchObject({ path: '/p/petalworks', jumps: 1 });
  });

  it('knows every path the log named, and nothing else', () => {
    const paths = knownPaths([entry({
      candidates: [{ path: '/p/a', score: 1 }],
      questions: [{ kind: 'picker', options: ['/p/b'], answer: null }],
    })]);
    expect([...paths].sort()).toEqual(['/p/a', '/p/b', '/p/petalworks']);
  });
});

describe('the learn answer', () => {
  it('drops malformed items and any setting that is not a cdai command', () => {
    const answer = readLearnAnswer(JSON.parse(answerJson([{ words: 'The Flower Client', path: '/p', why: 'w' }, { words: '' }])));
    expect(answer?.aliases).toEqual([{ words: 'the flower client', path: '/p', why: 'w' }]);
    expect(answer?.settings.map((s) => s.command)).toEqual(['cdai setup --root ~/work --yes']);
    expect(readLearnAnswer({ summary: 'x', aliases: 'none' })).toBeNull();
  });

  it('reads its own arguments strictly', () => {
    expect(parseLearnArgs(['--with', 'codex', '--model', 'gpt-5'])).toEqual({ backend: 'codex', model: 'gpt-5', printPrompt: false });
    expect(parseLearnArgs(['--with', 'gemini'])).toBeNull();
    expect(parseLearnArgs(['--model'])).toBeNull();
  });

  it('prefers claude, falls back to codex, and asks claude for a strong model', () => {
    const only = (name: string) => (command: string) => (command === name ? `/bin/${name}` : null);
    expect(resolveLearnBackend(null, '', only('claude'))).toMatchObject({ kind: 'claude', model: 'opus' });
    expect(resolveLearnBackend(null, '', only('codex'))).toMatchObject({ kind: 'codex', model: '' });
    expect(resolveLearnBackend('codex', '', only('claude'))).toBeNull();
  });
});

describe('cdai learn', () => {
  it('has nothing to say before anything was logged', () => {
    writeConfig(fixture);
    const result = runCli('learn');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('nothing to learn from yet');
  });

  it('prints the prompt and sends nothing with --print-prompt', () => {
    logDecisions();
    claudeShim(answerJson([]));
    const result = runCli('learn', '--print-prompt');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"words":"the flower client"');
    expect(existsSync(join(shimDir, 'args.txt'))).toBe(false);
  });

  it('asks claude once, refuses aliases the log never named, and keeps the report', () => {
    logDecisions();
    const petal = join(fixture.clients, 'petalworks');
    claudeShim(answerJson([
      { words: 'flower client', path: petal, why: 'asked twice' },
      { words: 'secret place', path: '/etc', why: 'invented' },
    ]));
    const result = runCli('learn');
    expect(result.status).toBe(0);
    const args = readFileSync(join(shimDir, 'args.txt'), 'utf8');
    expect(args).toContain('--json-schema');
    expect(args).toContain('opus');
    expect(result.stdout).toContain('`flower client` -> `~/clients/petalworks` - asked twice (not asked)');
    expect(result.stdout).toContain('(refused: not a directory from the log)');
    expect(result.stdout).not.toContain('rm -rf');
    const reports = readdirSync(join(fixture.dataDir, 'learn'));
    expect(reports).toHaveLength(1);
  });

  it('remembers a learned alias only once the person says yes', () => {
    logDecisions();
    claudeShim(answerJson([{ words: 'flower client', path: join(fixture.clients, 'petalworks'), why: 'asked' }]));
    expect(runCliWithTty('y\n', 'learn').status).toBe(0);
    const query = runCli('query', '--', 'the flower client');
    expect(query.stdout.trim()).toBe(join(fixture.clients, 'petalworks'));
    const report = readdirSync(join(fixture.dataDir, 'learn'))[0] ?? '';
    expect(readFileSync(join(fixture.dataDir, 'learn', report), 'utf8')).toContain('(remembered)');
  });

  it('asks codex with a schema file and reads its last message', () => {
    logDecisions();
    writeFileSync(join(shimDir, 'answer.json'), answerJson([]));
    writeShim('codex', [
      'while [ $# -gt 0 ]; do',
      '  case "$1" in',
      `    --output-schema) test -s "$2" || exit 9; shift ;;`,
      `    -o) cp '${join(shimDir, 'answer.json')}' "$2"; shift ;;`,
      '  esac; shift',
      'done',
    ].join('\n'));
    const result = runCli('learn', '--with', 'codex');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Mostly clean hits.');
  });

  it('names the backend when it fails', () => {
    logDecisions();
    writeShim('claude', 'echo "not logged in" >&2; exit 2');
    const result = runCli('learn', '--with', 'claude');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('claude exited with 2: not logged in');
  });
});

describe('cdai learn and existing aliases', () => {
  it('refuses an alias whose words already answer, filler words and all', () => {
    logDecisions();
    const petal = join(fixture.clients, 'petalworks');
    expect(runCli('alias', 'add', petal, '--', 'flower client').status).toBe(0);
    claudeShim(answerJson([{ words: 'the flower client folder', path: petal, why: 'asked' }]));
    expect(runCli('learn').stdout).toContain('(refused: those words already have an alias)');
  });
});
