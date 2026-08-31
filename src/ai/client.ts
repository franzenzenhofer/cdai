import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { aiArgs, type AiBackend } from './backend.js';

const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_JSON_CANDIDATES = 32;
const MAX_ENVELOPE_DEPTH = 6;
const MAX_REASON_LENGTH = 120;
const ENVELOPE_KEYS = [
  'result',
  'response',
  'content',
  'text',
  'output',
  'output_text',
  'message',
  'choices',
  'candidates',
] as const;

export type AiOutcome =
  | { readonly kind: 'path'; readonly path: string; readonly reason: string }
  | { readonly kind: 'none'; readonly why: string };

export interface AiAnswer {
  readonly path: string | null;
  readonly reason: string;
}

export interface AiRequest {
  readonly prompt: string;
  readonly candidates: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const balancedObjectAt = (text: string, start: number): string | null => {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (quoted && escaped) escaped = false;
    else if (quoted && char === '\\') escaped = true;
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === '{') depth += 1;
    else if (!quoted && char === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
};

/** Pulls the first balanced object while respecting braces and escapes inside JSON strings. */
export const extractJsonBlock = (text: string): string | null => {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const block = balancedObjectAt(text, start);
    if (block !== null) return block;
  }
  return null;
};

const jsonValues = (text: string): unknown[] => {
  const exact = parseJson(text.trim());
  if (exact !== undefined) return [exact];
  const values: unknown[] = [];
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const block = balancedObjectAt(text, start);
    const parsed = block === null ? undefined : parseJson(block);
    if (parsed !== undefined) values.push(parsed);
    if (values.length >= MAX_JSON_CANDIDATES) break;
  }
  return values;
};

const directAnswer = (value: unknown): AiAnswer | null => {
  if (!isRecord(value) || !Object.hasOwn(value, 'path')) return null;
  const path = value['path'];
  if (path !== null && typeof path !== 'string') return null;
  const reason = value['reason'];
  return {
    path: path === null || path === '' ? null : path,
    reason: typeof reason === 'string' ? reason : '',
  };
};

const childrenOf = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  return ENVELOPE_KEYS.flatMap((key) => (Object.hasOwn(value, key) ? [value[key]] : []));
};

/** Handles bare JSON plus Claude, Apfel, Gemini, and OpenAI-compatible JSON envelopes. */
export const parseAiAnswer = (raw: string): AiAnswer | null => {
  const queue: Array<readonly [unknown, number]> = [[raw, 0]];
  const seenText = new Set<string>();
  while (queue.length > 0) {
    const [value, depth] = queue.shift() ?? [];
    const answer = directAnswer(value);
    if (answer !== null) return answer;
    if (depth === undefined || depth >= MAX_ENVELOPE_DEPTH) continue;
    if (typeof value === 'string') {
      if (seenText.has(value)) continue;
      seenText.add(value);
      queue.push(...jsonValues(value).map((parsed) => [parsed, depth + 1] as const));
    } else {
      queue.push(...childrenOf(value).map((child) => [child, depth + 1] as const));
    }
  }
  return null;
};

const runCommand = (backend: AiBackend, prompt: string, timeoutMs: number): Promise<string> =>
  new Promise((resolveOutput, reject) => {
    const child = spawn(backend.command, aiArgs(backend, prompt), {
      env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`${backend.kind} timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);
    const finish = (error: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error === null) resolveOutput(output);
      else reject(error);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (settled) return;
      output += chunk;
      if (Buffer.byteLength(output) <= MAX_OUTPUT_BYTES) return;
      child.kill();
      finish(new Error(`${backend.kind} output exceeded 1 MiB`));
    });
    child.on('error', finish);
    child.on('close', (code) =>
      finish(code === 0 ? null : new Error(`${backend.kind} exited with ${String(code)}`)));
  });

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Returns the original candidate, never the model-provided spelling of it. */
export const matchAiPath = (path: string, candidates: readonly string[]): string | null => {
  let requested: string;
  try {
    requested = resolve(path);
  } catch {
    return null;
  }
  return candidates.find((candidate) => resolve(candidate) === requested && isDirectory(candidate)) ?? null;
};

export const sanitizeReason = (reason: string): string => {
  const visible = [...reason]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? ' ' : char;
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
  return visible.slice(0, MAX_REASON_LENGTH);
};

export const askAi = async (
  request: AiRequest,
  backend: AiBackend,
  timeoutMs: number,
): Promise<AiOutcome> => {
  if (request.candidates.length === 0) return { kind: 'none', why: 'no candidates' };
  let raw: string;
  try {
    raw = await runCommand(backend, request.prompt, timeoutMs);
  } catch (error) {
    return { kind: 'none', why: error instanceof Error ? error.message : 'ai backend failed' };
  }
  const answer = parseAiAnswer(raw);
  if (answer === null) return { kind: 'none', why: 'unparseable answer' };
  const reason = sanitizeReason(answer.reason);
  if (answer.path === null) return { kind: 'none', why: reason === '' ? 'no idea' : reason };
  const path = matchAiPath(answer.path, request.candidates);
  if (path === null) return { kind: 'none', why: 'answer was not one of the offered directories' };
  return { kind: 'path', path, reason };
};
