import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AiBackend } from './backend.js';
import { runAiCommand } from './process.js';
import { flattenText } from './text.js';

const MAX_JSON_CANDIDATES = 32;
const MAX_ENVELOPE_DEPTH = 6;
const MAX_REASON_LENGTH = 120;
const MAX_EXCERPT_LENGTH = 80;
const ENVELOPE_KEYS = [
  // A schema-validated answer is already the object cdai asked for, so it is read before prose.
  'structured_output',
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

export const sanitizeReason = (reason: string): string => flattenText(reason, MAX_REASON_LENGTH);

/** Without a look at what the backend actually said, "unparseable answer" is a dead end. */
const excerpt = (raw: string): string => {
  const visible = flattenText(raw.slice(0, MAX_EXCERPT_LENGTH * 4), MAX_EXCERPT_LENGTH);
  if (visible === '') return 'unparseable answer, backend said nothing';
  return `unparseable answer: ${visible}`;
};

export const askAi = async (
  request: AiRequest,
  backend: AiBackend,
  timeoutMs: number,
): Promise<AiOutcome> => {
  if (request.candidates.length === 0) return { kind: 'none', why: 'no candidates' };
  let raw: string;
  try {
    raw = await runAiCommand(backend, request.prompt, timeoutMs);
  } catch (error) {
    return { kind: 'none', why: error instanceof Error ? error.message : 'ai backend failed' };
  }
  if (process.env['CDAI_DEBUG'] === '1') process.stderr.write(`cdai: raw ai output\n${raw}\n`);
  const answer = parseAiAnswer(raw);
  if (answer === null) return { kind: 'none', why: excerpt(raw) };
  const reason = sanitizeReason(answer.reason);
  if (answer.path === null) return { kind: 'none', why: reason === '' ? 'no idea' : reason };
  const path = matchAiPath(answer.path, request.candidates);
  if (path === null) return { kind: 'none', why: 'answer was not one of the offered directories' };
  return { kind: 'path', path, reason };
};
