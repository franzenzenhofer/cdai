import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import type { AiConfig, Config } from '../config.js';
import { isUnder } from '../paths.js';

export type AiOutcome =
  | { readonly kind: 'path'; readonly path: string; readonly reason: string }
  | { readonly kind: 'none'; readonly why: string };

export interface AiAnswer {
  readonly path: string | null;
  readonly reason: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Pulls the first balanced {...} block out of arbitrary text. */
export const extractJsonBlock = (text: string): string | null => {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** Unwraps the CLI envelope (`{"result": "..."}`) and then the model's own JSON answer. */
export const parseAiAnswer = (raw: string): AiAnswer | null => {
  const envelope = parseJson(raw);
  const inner =
    isRecord(envelope) && typeof envelope['result'] === 'string' ? envelope['result'] : raw;
  const block = extractJsonBlock(inner);
  if (block === null) return null;
  const parsed = parseJson(block);
  if (!isRecord(parsed)) return null;
  const path = parsed['path'];
  const reason = parsed['reason'];
  if (path !== null && typeof path !== 'string') return null;
  return {
    path: path === null || path === '' ? null : path,
    reason: typeof reason === 'string' ? reason : '',
  };
};

export const aiArgs = (ai: AiConfig, prompt: string): string[] => [
  ...ai.args,
  '-p',
  '--model',
  ai.model,
  '--output-format',
  'json',
  '--tools',
  '',
  '--no-session-persistence',
  prompt,
];

const runCommand = (ai: AiConfig, prompt: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(ai.command, aiArgs(ai, prompt), {
      signal: AbortSignal.timeout(ai.timeoutMs),
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${ai.command} exited with ${String(code)}`)),
    );
  });

const isDirectory = (path: string): boolean => {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** A returned path is only accepted when it exists and sits under a configured root. */
export const validateAiPath = (path: string, config: Config): boolean =>
  isDirectory(path) && config.roots.some((root) => isUnder(path, root.path));

export const askAi = async (prompt: string, config: Config): Promise<AiOutcome> => {
  let raw: string;
  try {
    raw = await runCommand(config.ai, prompt);
  } catch (error) {
    return { kind: 'none', why: error instanceof Error ? error.message : 'ai backend failed' };
  }
  const answer = parseAiAnswer(raw);
  if (answer === null) return { kind: 'none', why: 'unparseable answer' };
  if (answer.path === null) return { kind: 'none', why: answer.reason === '' ? 'no idea' : answer.reason };
  if (!validateAiPath(answer.path, config)) {
    return { kind: 'none', why: 'answer is not an existing directory under a configured root' };
  }
  return { kind: 'path', path: answer.path, reason: answer.reason };
};
