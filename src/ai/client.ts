import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { askBackend, sanitizeReason } from '@franzenzenhofer/intent-core/ai/ask';
import { unwrapAnswer } from '@franzenzenhofer/intent-core/ai/envelope';
import type { AiBackend } from '@franzenzenhofer/intent-core/ai/backend';
import { ANSWER_CONTRACT } from './claude.js';

export { extractJsonBlock } from '@franzenzenhofer/intent-core/ai/envelope';
export { sanitizeReason };

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

/** What a real answer looks like. Anything else keeps the envelope search going. */
export const readAiAnswer = (value: unknown): AiAnswer | null => {
  if (!isRecord(value) || !Object.hasOwn(value, 'path')) return null;
  const path = value['path'];
  if (path !== null && typeof path !== 'string') return null;
  const reason = value['reason'];
  return {
    path: path === null || path === '' ? null : path,
    reason: typeof reason === 'string' ? reason : '',
  };
};

/** Handles bare JSON plus Claude, Apfel, Gemini and OpenAI-compatible JSON envelopes. */
export const parseAiAnswer = (raw: string): AiAnswer | null => unwrapAnswer(raw, readAiAnswer);

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

export const askAi = async (
  request: AiRequest,
  backend: AiBackend,
  timeoutMs: number,
): Promise<AiOutcome> => {
  if (request.candidates.length === 0) return { kind: 'none', why: 'no candidates' };
  const asked = await askBackend(backend, request.prompt, {
    contract: ANSWER_CONTRACT,
    timeoutMs,
    read: readAiAnswer,
    debug: process.env['CDAI_DEBUG'] === '1',
  });
  if (asked.kind === 'none') return { kind: 'none', why: asked.why };
  const reason = sanitizeReason(asked.answer.reason);
  if (asked.answer.path === null) return { kind: 'none', why: reason === '' ? 'no idea' : reason };
  const path = matchAiPath(asked.answer.path, request.candidates);
  if (path === null) return { kind: 'none', why: 'answer was not one of the offered directories' };
  return { kind: 'path', path, reason };
};
