import { sanitizeReason } from '@franzenzenhofer/intent-core/ai/ask';
import { normalizeIntent } from '../store/aliases.js';

const MAX_SUGGESTIONS = 20;
const MAX_TEXT = 600;

export interface LearnedAlias {
  readonly words: string;
  readonly path: string;
  readonly why: string;
}

export interface LearnedSetting {
  readonly command: string;
  readonly why: string;
}

export interface LearnedImprovement {
  readonly title: string;
  readonly evidence: string;
  readonly proposal: string;
}

export interface LearnAnswer {
  readonly summary: string;
  readonly aliases: readonly LearnedAlias[];
  readonly settings: readonly LearnedSetting[];
  readonly improvements: readonly LearnedImprovement[];
}

const strings = (names: readonly string[]): object => ({
  type: 'object',
  properties: Object.fromEntries(names.map((name) => [name, { type: 'string' }])),
  required: names,
  additionalProperties: false,
});

const list = (names: readonly string[]): object => ({ type: 'array', items: strings(names) });

/** Strict in the OpenAI sense too: every key required, nothing extra, so Codex accepts it as is. */
export const LEARN_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    summary: { type: 'string' },
    aliases: list(['words', 'path', 'why']),
    settings: list(['command', 'why']),
    improvements: list(['title', 'evidence', 'proposal']),
  },
  required: ['summary', 'aliases', 'settings', 'improvements'],
  additionalProperties: false,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Multi-line prose is allowed here, unlike a jump reason, but control characters never are. */
const text = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/[^\P{C}\n]/gu, '').trim().slice(0, MAX_TEXT) : '';

const readList = <T>(value: unknown, read: (item: Record<string, unknown>) => T | null): T[] | null => {
  if (!Array.isArray(value)) return null;
  return value.filter(isRecord).map(read).filter((item): item is T => item !== null).slice(0, MAX_SUGGESTIONS);
};

const readAlias = (item: Record<string, unknown>): LearnedAlias | null => {
  const words = normalizeIntent(text(item['words']));
  const path = typeof item['path'] === 'string' ? item['path'] : '';
  return words === '' || path === '' ? null : { words, path, why: sanitizeReason(text(item['why'])) };
};

const readSetting = (item: Record<string, unknown>): LearnedSetting | null => {
  const command = sanitizeReason(text(item['command']));
  return command.startsWith('cdai ') ? { command, why: text(item['why']) } : null;
};

const readImprovement = (item: Record<string, unknown>): LearnedImprovement | null => {
  const title = sanitizeReason(text(item['title']));
  return title === '' ? null : { title, evidence: text(item['evidence']), proposal: text(item['proposal']) };
};

/** What a real answer looks like; anything else keeps the envelope search going. */
export const readLearnAnswer = (value: unknown): LearnAnswer | null => {
  if (!isRecord(value) || typeof value['summary'] !== 'string') return null;
  const aliases = readList(value['aliases'], readAlias);
  const settings = readList(value['settings'], readSetting);
  const improvements = readList(value['improvements'], readImprovement);
  if (aliases === null || settings === null || improvements === null) return null;
  return { summary: text(value['summary']), aliases, settings, improvements };
};
