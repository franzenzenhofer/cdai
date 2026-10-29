import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeArgs } from '@franzenzenhofer/intent-core/ai/cli-args';
import { unwrapAnswer } from '@franzenzenhofer/intent-core/ai/envelope';
import { exitError, runContained } from '@franzenzenhofer/intent-core/ai/spawn';
import { resolveExecutable } from '@franzenzenhofer/intent-core/executable';
import { LEARN_SCHEMA, readLearnAnswer, type LearnAnswer } from './answer.js';

export const LEARN_BACKENDS = ['claude', 'codex'] as const;
export type LearnBackendKind = (typeof LEARN_BACKENDS)[number];

/** Learning reads a whole log and reasons about a matcher, so it asks a strong model, not a fast one. */
const DEFAULT_MODEL: Readonly<Record<LearnBackendKind, string>> = { claude: 'opus', codex: '' };
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 8192;

export interface LearnBackend {
  readonly kind: LearnBackendKind;
  readonly command: string;
  readonly model: string;
}

const SYSTEM_PROMPT =
  'You analyse the decision log of a directory-jumping shell tool and reply with exactly one JSON '
  + 'object matching the given schema. No preamble, no code fence.';

export const resolveLearnBackend = (
  wanted: LearnBackendKind | null,
  model: string,
  resolve: (command: string) => string | null = resolveExecutable,
): LearnBackend | null => {
  for (const kind of wanted === null ? LEARN_BACKENDS : [wanted]) {
    const command = resolve(kind);
    if (command !== null) return { kind, command, model: model === '' ? DEFAULT_MODEL[kind] : model };
  }
  return null;
};

export const learnBackendLabel = (backend: LearnBackend): string =>
  backend.model === '' ? backend.kind : `${backend.kind} ${backend.model}`;

/** Read-only, ephemeral and outside any repo: Codex gets a question, not a workspace. */
const codexArgs = (backend: LearnBackend, prompt: string, dir: string): string[] => [
  'exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--color', 'never',
  '-C', dir, '--output-schema', join(dir, 'schema.json'), '-o', join(dir, 'answer.json'),
  ...(backend.model === '' ? [] : ['-m', backend.model]),
  `${SYSTEM_PROMPT}\n\n${prompt}`,
];

const run = async (backend: LearnBackend, args: readonly string[], timeoutMs: number): Promise<string> => {
  const result = await runContained(backend.command, args, {
    timeoutMs, maxOutputBytes: MAX_OUTPUT_BYTES, maxStderrBytes: MAX_STDERR_BYTES,
    label: backend.kind, captureStdout: true,
  });
  if (result.status !== 0) throw exitError(backend.kind, result.status, result.stderr);
  return result.stdout;
};

const askCodex = async (backend: LearnBackend, prompt: string, timeoutMs: number): Promise<string> => {
  const dir = mkdtempSync(join(tmpdir(), 'cdai-learn-'));
  try {
    writeFileSync(join(dir, 'schema.json'), LEARN_SCHEMA, { mode: 0o600 });
    await run(backend, codexArgs(backend, prompt, dir), timeoutMs);
    return readFileSync(join(dir, 'answer.json'), 'utf8');
  } finally {
    // The answer names the person's directories; it is read once and never left behind.
    rmSync(dir, { recursive: true, force: true });
  }
};

/** One question, one validated answer, or an error that names the backend and what it said. */
export const askLearn = async (backend: LearnBackend, prompt: string, timeoutMs: number): Promise<LearnAnswer> => {
  const raw = backend.kind === 'codex'
    ? await askCodex(backend, prompt, timeoutMs)
    : await run(backend, claudeArgs([], backend.model, prompt,
      { systemPrompt: SYSTEM_PROMPT, schema: LEARN_SCHEMA }), timeoutMs);
  const answer = unwrapAnswer(raw, readLearnAnswer);
  if (answer === null) throw new Error(`${backend.kind} answered, but not in the learn schema`);
  return answer;
};
