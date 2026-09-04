import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aiArgs,
  backendKind,
  resolveAiBackend,
  type AiBackend,
} from '../src/ai/backend.js';
import {
  askAi,
  extractJsonBlock,
  matchAiPath,
  parseAiAnswer,
  sanitizeReason,
  type AiRequest,
} from '../src/ai/client.js';
import { buildAiRequest } from '../src/ai/prompt.js';
import { DEFAULT_AI, type AiConfig } from '../src/config.js';
import { emptyDb, type Db } from '../src/store/db.js';
import { makeFixture, writeConfig, type Fixture } from './fixtures.js';

const EXECUTABLE = 0o755;
const SHIM_TIMEOUT_MS = 10_000;
const FAST_TIMEOUT_MS = 300;
const DESCENDANT_TIMEOUT_MS = 1000;
const TIMEOUT_SLACK_MS = 5000;
let fixture: Fixture;
let shimDir = '';

const processTerminated = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
  } catch {
    return true;
  }
  if (process.platform !== 'linux') return false;
  try {
    // Minimal containers may leave an already-killed orphan as a zombie until PID 1 reaps it.
    return readFileSync(`/proc/${String(pid)}/stat`, 'utf8').split(' ')[2] === 'Z';
  } catch {
    return true;
  }
};

/** A real executable on PATH, spawned as a real subprocess. Nothing here is mocked. */
const writeShim = (body: string): string => {
  const shim = join(shimDir, 'claude-shim');
  writeFileSync(shim, `#!/bin/sh\n${body}\n`);
  chmodSync(shim, EXECUTABLE);
  return shim;
};

const aiConfig = (ai: Partial<AiConfig> = {}): AiConfig => ({
  ...DEFAULT_AI,
  args: [],
  timeoutMs: SHIM_TIMEOUT_MS,
  ...ai,
});

const backendFor = (command: string): AiBackend => ({
  kind: 'custom',
  command,
  model: '',
  extraArgs: [],
});

const requestFor = (candidates: readonly string[]): AiRequest => ({ prompt: 'PROMPT', candidates });

beforeEach(() => {
  fixture = makeFixture();
  shimDir = fixture.rootDir;
  process.env['CDAI_CONFIG_DIR'] = fixture.configDir;
  process.env['CDAI_DATA_DIR'] = fixture.dataDir;
  writeConfig(fixture);
});

afterEach(() => {
  fixture.cleanup();
  delete process.env['CDAI_CONFIG_DIR'];
  delete process.env['CDAI_DATA_DIR'];
});

describe('extractJsonBlock', () => {
  it('pulls the first balanced object out of chatty text', () => {
    expect(extractJsonBlock('sure! {"path": {"a": 1}} trailing')).toBe('{"path": {"a": 1}}');
    expect(extractJsonBlock('no json here')).toBeNull();
  });

  it('ignores braces inside quoted strings and finds a later complete object', () => {
    expect(extractJsonBlock('{"path":"/a/{b}","reason":"say \\"}\\""} trailing')).toBe(
      '{"path":"/a/{b}","reason":"say \\"}\\""}',
    );
    expect(extractJsonBlock('broken { then {"path":null}')).toBe('{"path":null}');
  });
});

describe('parseAiAnswer', () => {
  it('unwraps the CLI envelope and the model answer', () => {
    const raw = JSON.stringify({ result: 'here you go {"path": "/a/b", "reason": "client folder"}' });
    expect(parseAiAnswer(raw)).toEqual({ path: '/a/b', reason: 'client folder' });
  });

  it('accepts a bare answer without the envelope', () => {
    expect(parseAiAnswer('{"path": "/a/b"}')).toEqual({ path: '/a/b', reason: '' });
  });

  it('unwraps Apfel, Gemini, and OpenAI-compatible envelopes', () => {
    const answer = '{"path":"/a/b","reason":"match"}';
    expect(parseAiAnswer(JSON.stringify({ content: answer }))).toEqual({ path: '/a/b', reason: 'match' });
    expect(parseAiAnswer(JSON.stringify({ response: answer }))).toEqual({ path: '/a/b', reason: 'match' });
    expect(parseAiAnswer(JSON.stringify({ choices: [{ message: { content: answer } }] }))).toEqual({
      path: '/a/b',
      reason: 'match',
    });
  });

  it('prefers the schema-validated answer over the prose the CLI also returns', () => {
    const raw = JSON.stringify({
      result: 'Sure! Here is the folder you meant.',
      structured_output: { path: '/a/b', reason: 'schema validated' },
    });
    expect(parseAiAnswer(raw)).toEqual({ path: '/a/b', reason: 'schema validated' });
  });

  it('reads an explicit null answer', () => {
    expect(parseAiAnswer('{"path": null, "reason": "no idea"}')).toEqual({ path: null, reason: 'no idea' });
  });

  it('rejects garbage and wrong types', () => {
    expect(parseAiAnswer('total garbage')).toBeNull();
    expect(parseAiAnswer('{"path": 42}')).toBeNull();
  });
});

describe('AI backends', () => {
  it('detects known commands by basename', () => {
    expect(backendKind('/opt/homebrew/bin/apfel')).toBe('apfel');
    expect(backendKind('/usr/local/bin/claude')).toBe('claude');
    expect(backendKind('gemini')).toBe('gemini');
    expect(backendKind('ollama')).toBe('ollama');
    expect(backendKind('my-ai')).toBe('custom');
  });

  it('prefers Apfel during automatic detection', () => {
    const found = new Set(['apfel', 'claude']);
    const resolved = resolveAiBackend(aiConfig({ command: 'auto' }), (command) =>
      found.has(command) ? `/bin/${command}` : null,
    );
    expect(resolved).toMatchObject({ kind: 'apfel', command: '/bin/apfel', model: '' });
  });

  it('falls through automatic backends and requires an Ollama model', () => {
    const onlyOllama = (command: string): string | null => (command === 'ollama' ? '/bin/ollama' : null);
    expect(resolveAiBackend(aiConfig({ command: 'auto' }), onlyOllama)).toBeNull();
    expect(resolveAiBackend(aiConfig({ command: 'auto', model: 'qwen3:4b' }), onlyOllama)).toMatchObject({
      kind: 'ollama',
      model: 'qwen3:4b',
    });
  });

  it('builds safe provider-specific invocations', () => {
    const claude = resolveAiBackend(aiConfig({ command: 'claude' }), () => '/bin/claude');
    expect(claude).not.toBeNull();
    expect(aiArgs(claude as AiBackend, 'PROMPT')).toEqual([
      '-p',
      '--model',
      'sonnet',
      '--output-format',
      'json',
      '--tools',
      '',
      '--safe-mode',
      '--strict-mcp-config',
      '--system-prompt',
      expect.stringContaining('exactly one JSON object'),
      '--json-schema',
      expect.stringContaining('"required":["path","reason"]'),
      '--no-session-persistence',
      'PROMPT',
    ]);
    expect(aiArgs({ kind: 'apfel', command: 'apfel', model: '', extraArgs: [] }, '-PROMPT')).toEqual([
      '-o', 'json', '--temperature', '0', '--max-tokens', '192', '--', '-PROMPT',
    ]);
    expect(aiArgs({ kind: 'gemini', command: 'gemini', model: '', extraArgs: [] }, 'PROMPT')).toEqual([
      '--output-format', 'json', '--prompt', 'PROMPT',
    ]);
    expect(aiArgs({ kind: 'ollama', command: 'ollama', model: 'qwen3', extraArgs: [] }, 'PROMPT')).toEqual([
      'run', 'qwen3', '--format', 'json', 'PROMPT',
    ]);
  });

  it('expands custom placeholders or appends the prompt', () => {
    const custom: AiBackend = {
      kind: 'custom', command: 'other-ai', model: 'small', extraArgs: ['run', '{model}', '{prompt}'],
    };
    expect(aiArgs(custom, 'PROMPT')).toEqual(['run', 'small', 'PROMPT']);
    expect(aiArgs({ ...custom, extraArgs: ['ask'] }, 'PROMPT')).toEqual(['ask', 'PROMPT']);
  });
});

describe('matchAiPath', () => {
  it('returns the original offered path for an equivalent existing path', () => {
    const target = `${fixture.clients}/petalworks`;
    expect(matchAiPath(`${target}/`, [target])).toBe(target);
  });

  it('rejects unoffered directories, files, and missing paths', () => {
    const offered = [`${fixture.clients}/petalworks`];
    expect(matchAiPath(`${fixture.clients}/acme-shop`, offered)).toBeNull();
    expect(matchAiPath(`${fixture.projects}/squash/readme.md`, [`${fixture.projects}/squash/readme.md`])).toBeNull();
    expect(matchAiPath(`${fixture.clients}/ghost`, [`${fixture.clients}/ghost`])).toBeNull();
  });
});

describe('askAi against a real shim process', () => {
  it('accepts a good answer', async () => {
    const target = `${fixture.clients}/petalworks`;
    const command = writeShim(`printf '%s' '{"result": "{\\"path\\": \\"${target}\\", \\"reason\\": \\"flowers\\"}"}'`);
    const outcome = await askAi(requestFor([target]), backendFor(command), SHIM_TIMEOUT_MS);
    expect(outcome).toEqual({ kind: 'path', path: target, reason: 'flowers' });
  });

  it('degrades on garbage output and quotes what the backend said', async () => {
    const command = writeShim(`printf 'I am a helpful assistant and I love talking'`);
    const outcome = await askAi(requestFor([fixture.clients]), backendFor(command), SHIM_TIMEOUT_MS);
    expect(outcome).toEqual({
      kind: 'none',
      why: 'unparseable answer: I am a helpful assistant and I love talking',
    });
  });

  it('names an empty answer instead of blaming the parser', async () => {
    const command = writeShim(`printf ''`);
    const outcome = await askAi(requestFor([fixture.clients]), backendFor(command), SHIM_TIMEOUT_MS);
    expect(outcome).toEqual({ kind: 'none', why: 'unparseable answer, backend said nothing' });
  });

  it('rejects even an existing in-root path when it was not offered', async () => {
    const hallucinated = `${fixture.clients}/acme-shop`;
    const command = writeShim(`printf '%s' '{"path": "${hallucinated}"}'`);
    const outcome = await askAi(
      requestFor([`${fixture.clients}/petalworks`]),
      backendFor(command),
      SHIM_TIMEOUT_MS,
    );
    expect(outcome).toEqual({ kind: 'none', why: 'answer was not one of the offered directories' });
  });

  it('degrades on a timeout instead of hanging', async () => {
    const command = writeShim('sleep 30');
    const started = Date.now();
    const outcome = await askAi(requestFor([fixture.clients]), backendFor(command), FAST_TIMEOUT_MS);
    expect(outcome.kind).toBe('none');
    expect(Date.now() - started).toBeLessThan(TIMEOUT_SLACK_MS);
  });

  it('terminates backend descendants when the timeout fires', async () => {
    const pidFile = join(fixture.rootDir, 'descendant.pid');
    const command = writeShim(`sleep 30 & echo $! > '${pidFile}'; wait`);
    const started = Date.now();
    const outcome = await askAi(requestFor([fixture.clients]), backendFor(command), DESCENDANT_TIMEOUT_MS);
    expect(outcome.kind).toBe('none');
    expect(Date.now() - started).toBeLessThan(3000);
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(processTerminated(pid)).toBe(true);
  });

  it('degrades when the backend exits non zero and quotes its own complaint', async () => {
    const command = writeShim(`echo "error: unknown option '--safe-mode'" >&2; exit 7`);
    const outcome = await askAi(requestFor([fixture.clients]), backendFor(command), SHIM_TIMEOUT_MS);
    expect(outcome).toEqual({
      kind: 'none',
      why: "custom exited with 7: error: unknown option '--safe-mode'",
    });
  });

  it('still reports a bare exit code when the backend says nothing', async () => {
    const command = writeShim('exit 7');
    const outcome = await askAi(requestFor([fixture.clients]), backendFor(command), SHIM_TIMEOUT_MS);
    expect(outcome).toEqual({ kind: 'none', why: 'custom exited with 7' });
  });

  it('drains a noisy stderr instead of letting a full pipe stall the answer', async () => {
    const target = `${fixture.clients}/petalworks`;
    const command = writeShim(
      `head -c 200000 /dev/zero | tr '\\0' 'w' >&2\n`
      + `printf '%s' '{"path": "${target}", "reason": "loud but fine"}'`,
    );
    const outcome = await askAi(requestFor([target]), backendFor(command), SHIM_TIMEOUT_MS);
    expect(outcome).toEqual({ kind: 'path', path: target, reason: 'loud but fine' });
  });

  it('caps backend output instead of buffering without limit', async () => {
    const command = writeShim('head -c 1100000 /dev/zero');
    const outcome = await askAi(requestFor([fixture.clients]), backendFor(command), SHIM_TIMEOUT_MS);
    expect(outcome).toEqual({ kind: 'none', why: 'custom output exceeded 1 MiB' });
  });

  it('degrades when the backend does not exist', async () => {
    const outcome = await askAi(
      requestFor([fixture.clients]),
      backendFor('/no/such/backend'),
      SHIM_TIMEOUT_MS,
    );
    expect(outcome.kind).toBe('none');
  });

  it('does not spawn a backend when there are no candidates', async () => {
    const outcome = await askAi(requestFor([]), backendFor('/no/such/backend'), SHIM_TIMEOUT_MS);
    expect(outcome).toEqual({ kind: 'none', why: 'no candidates' });
  });
});

describe('buildAiRequest', () => {
  it('contains escaped, deduplicated, in-root candidates and the reply contract', () => {
    const target = `${fixture.clients}/petalworks`;
    const db: Db = {
      ...emptyDb(),
      records: [
        { path: target, visits: 4, lastVisit: 1_800_000_000 },
        { path: '/private/outside', visits: 100, lastVisit: 1_800_000_000 },
      ],
    };
    const request = buildAiRequest({
      query: 'that client with the flowers',
      cwd: fixture.rootDir,
      ranked: [{ candidate: { path: target, name: 'petalworks', mtime: 0, root: fixture.clients }, score: 400 }],
      db,
      nowSeconds: 1_800_000_000,
      roots: [fixture.clients],
    });
    expect(request.prompt).toContain('that client with the flowers');
    expect(request.prompt).toContain(target);
    expect(request.prompt).toContain('"path": null');
    expect(request.prompt).not.toContain('/private/outside');
    expect(request.candidates).toEqual([target]);
  });
});

describe('sanitizeReason', () => {
  it('flattens terminal control text and caps its length', () => {
    const reason = `flowers\n\u001b[31m${'x'.repeat(200)}`;
    expect(sanitizeReason(reason)).toBe(`flowers [31m${'x'.repeat(108)}`);
  });
});
