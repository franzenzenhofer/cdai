import { LIMIT } from '../match/constants.js';
import type { ScoredCandidate } from '../match/score.js';
import type { Db } from '../store/db.js';
import { frecency } from '../store/frecency.js';

export interface PromptInput {
  readonly query: string;
  readonly cwd: string;
  readonly ranked: readonly ScoredCandidate[];
  readonly db: Db;
  readonly nowSeconds: number;
}

const frecentPaths = (db: Db, nowSeconds: number): string[] =>
  [...db.records]
    .sort((a, b) => frecency(b, nowSeconds) - frecency(a, nowSeconds))
    .slice(0, LIMIT.aiFrecent)
    .map((record) => record.path);

const bullets = (paths: readonly string[]): string =>
  paths.length === 0 ? '  (none)' : paths.map((path) => `  ${path}`).join('\n');

/**
 * The reply contract is deliberately tiny: one JSON object, no prose. Anything else is
 * treated as "no answer" by the caller, so a chatty backend degrades instead of misfiring.
 */
export const buildPrompt = (input: PromptInput): string => {
  const fuzzy = input.ranked.slice(0, LIMIT.aiFuzzy).map((r) => r.candidate.path);
  return [
    'You map a shell user\'s vague directory request to exactly one existing directory path.',
    '',
    `User request: ${input.query}`,
    `Current directory: ${input.cwd}`,
    '',
    'Fuzzy match candidates (best first):',
    bullets(fuzzy),
    '',
    'Recently and frequently used directories:',
    bullets(frecentPaths(input.db, input.nowSeconds)),
    '',
    'Answer with ONE JSON object and nothing else:',
    '{"path": "<absolute path from the lists above>", "confidence": <0..1>, "reason": "<max 8 words>"}',
    'If no listed path plausibly matches, answer {"path": null, "reason": "<max 8 words>"}.',
    'Never invent a path that is not in the lists.',
  ].join('\n');
};
