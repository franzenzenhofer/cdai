import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { askAi, extractJsonBlock, aiArgs, parseAiAnswer, validateAiPath } from '../src/ai/claude.js';
import { buildPrompt } from '../src/ai/prompt.js';
import { DEFAULT_AI, loadConfig, type AiConfig, type Config } from '../src/config.js';
import { emptyDb } from '../src/store/db.js';
import { makeFixture, writeConfig, type Fixture } from './fixtures.js';

const EXECUTABLE = 0o755;
const SHIM_TIMEOUT_MS = 10_000;
const FAST_TIMEOUT_MS = 300;
const TIMEOUT_SLACK_MS = 5000;
let fixture: Fixture;
let shimDir = '';

/** A real executable on PATH, spawned as a real subprocess. Nothing here is mocked. */
const writeShim = (body: string): string => {
  const shim = join(shimDir, 'claude-shim');
  writeFileSync(shim, `#!/bin/sh\n${body}\n`);
  chmodSync(shim, EXECUTABLE);
  return shim;
};

const configWith = (ai: Partial<AiConfig>): Config => ({
  ...loadConfig(),
  ai: { ...DEFAULT_AI, args: [], timeoutMs: SHIM_TIMEOUT_MS, ...ai },
});

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
});

describe('parseAiAnswer', () => {
  it('unwraps the CLI envelope and the model answer', () => {
    const raw = JSON.stringify({ result: 'here you go {"path": "/a/b", "reason": "client folder"}' });
    expect(parseAiAnswer(raw)).toEqual({ path: '/a/b', reason: 'client folder' });
  });

  it('accepts a bare answer without the envelope', () => {
    expect(parseAiAnswer('{"path": "/a/b"}')).toEqual({ path: '/a/b', reason: '' });
  });

  it('reads an explicit null answer', () => {
    expect(parseAiAnswer('{"path": null, "reason": "no idea"}')).toEqual({ path: null, reason: 'no idea' });
  });

  it('rejects garbage and wrong types', () => {
    expect(parseAiAnswer('total garbage')).toBeNull();
    expect(parseAiAnswer('{"path": 42}')).toBeNull();
  });
});

describe('aiArgs', () => {
  it('builds the documented claude invocation', () => {
    expect(aiArgs({ ...DEFAULT_AI, args: [] }, 'PROMPT')).toEqual([
      '-p',
      '--model',
      'sonnet',
      '--output-format',
      'json',
      '--tools',
      '',
      '--no-session-persistence',
      'PROMPT',
    ]);
  });
});

describe('validateAiPath', () => {
  it('accepts an existing directory under a configured root', () => {
    expect(validateAiPath(`${fixture.clients}/petalworks`, loadConfig())).toBe(true);
  });

  it('rejects a path outside every root, a file and a ghost', () => {
    expect(validateAiPath('/etc', loadConfig())).toBe(false);
    expect(validateAiPath(`${fixture.projects}/squash/readme.md`, loadConfig())).toBe(false);
    expect(validateAiPath(`${fixture.clients}/ghost`, loadConfig())).toBe(false);
  });
});

describe('askAi against a real shim process', () => {
  it('accepts a good answer', async () => {
    const target = `${fixture.clients}/petalworks`;
    const command = writeShim(`printf '%s' '{"result": "{\\"path\\": \\"${target}\\", \\"reason\\": \\"flowers\\"}"}'`);
    const outcome = await askAi('prompt', configWith({ command }));
    expect(outcome).toEqual({ kind: 'path', path: target, reason: 'flowers' });
  });

  it('degrades on garbage output', async () => {
    const command = writeShim(`printf 'I am a helpful assistant and I love talking'`);
    const outcome = await askAi('prompt', configWith({ command }));
    expect(outcome).toEqual({ kind: 'none', why: 'unparseable answer' });
  });

  it('degrades on a hallucinated path', async () => {
    const command = writeShim(`printf '%s' '{"path": "/definitely/not/here"}'`);
    const outcome = await askAi('prompt', configWith({ command }));
    expect(outcome.kind).toBe('none');
    expect(outcome.kind === 'none' && outcome.why).toContain('configured root');
  });

  it('degrades on a timeout instead of hanging', async () => {
    const command = writeShim('sleep 30');
    const started = Date.now();
    const outcome = await askAi('prompt', configWith({ command, timeoutMs: FAST_TIMEOUT_MS }));
    expect(outcome.kind).toBe('none');
    expect(Date.now() - started).toBeLessThan(TIMEOUT_SLACK_MS);
  });

  it('degrades when the backend exits non zero', async () => {
    const command = writeShim('exit 7');
    const outcome = await askAi('prompt', configWith({ command }));
    expect(outcome.kind).toBe('none');
  });

  it('degrades when the backend does not exist', async () => {
    const outcome = await askAi('prompt', configWith({ command: '/no/such/backend' }));
    expect(outcome.kind).toBe('none');
  });
});

describe('buildPrompt', () => {
  it('contains the query, the candidates and the reply contract', () => {
    const prompt = buildPrompt({
      query: 'that client with the flowers',
      cwd: fixture.rootDir,
      ranked: [{ candidate: { path: `${fixture.clients}/petalworks`, name: 'petalworks', mtime: 0, root: fixture.clients }, score: 400 }],
      db: emptyDb(),
      nowSeconds: 1_800_000_000,
    });
    expect(prompt).toContain('that client with the flowers');
    expect(prompt).toContain(`${fixture.clients}/petalworks`);
    expect(prompt).toContain('"path": null');
  });
});
