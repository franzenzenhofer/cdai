import { BONUS, FUZZY, SCORE } from './constants.js';
import type { ParsedQuery } from './tokenize.js';

const SEGMENT_SPLIT = /[^a-z0-9]+/;
const LOG_BASE_2 = Math.LN2;

export interface Candidate {
  readonly path: string;
  readonly name: string;
  readonly mtime: number;
  readonly root: string;
}

export interface ScoreContext {
  readonly cwd: string;
  readonly frecencyByPath: ReadonlyMap<string, number>;
}

export interface ScoredCandidate {
  readonly candidate: Candidate;
  readonly score: number;
}

/** Longest run bonus for a subsequence match, 0 when the token is not a subsequence at all. */
export const fuzzyScore = (token: string, name: string): number => {
  if (token === '' || name === '') return SCORE.none;
  let first = -1;
  let last = -1;
  let cursor = 0;
  for (let i = 0; i < name.length && cursor < token.length; i += 1) {
    if (name[i] !== token[cursor]) continue;
    if (first === -1) first = i;
    last = i;
    cursor += 1;
  }
  if (cursor < token.length) return SCORE.none;
  const span = last - first + 1;
  const density = token.length / span;
  const coverage = token.length / name.length;
  const share = FUZZY.baseShare + FUZZY.densityShare * density + FUZZY.coverageShare * coverage;
  return Math.round(SCORE.fuzzyMax * share);
};

const hasBoundaryHit = (token: string, name: string): boolean =>
  name.split(SEGMENT_SPLIT).some((segment) => segment !== '' && segment.startsWith(token));

/** Match class of a single token against a single directory name. */
export const matchName = (token: string, name: string): number => {
  const lower = name.toLowerCase();
  if (lower === token) return SCORE.exact;
  if (lower.startsWith(token)) return SCORE.prefix;
  if (hasBoundaryHit(token, lower)) return SCORE.wordBoundary;
  if (lower.includes(token)) return SCORE.substring;
  return fuzzyScore(token, lower);
};

const parentPath = (path: string): string => {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '' : path.slice(0, idx);
};

const tokenScore = (token: string, candidate: Candidate): number => {
  const nameScore = matchName(token, candidate.name);
  if (nameScore > SCORE.none) return nameScore;
  return parentPath(candidate.path).toLowerCase().includes(token) ? SCORE.pathOnly : SCORE.none;
};

export const frecencyBonus = (frecency: number): number =>
  frecency <= 0 ? 0 : BONUS.frecency * (Math.log1p(frecency) / LOG_BASE_2);

const brevityBonus = (query: ParsedQuery, candidate: Candidate): number => {
  const queried = query.tokens.reduce((sum, token) => sum + token.length, 0);
  if (queried === 0 || candidate.name.length === 0) return 0;
  return BONUS.brevity * Math.min(1, queried / candidate.name.length);
};

const passesFilters = (query: ParsedQuery, candidate: Candidate): boolean => {
  const lowerPath = candidate.path.toLowerCase();
  if (!query.years.every((year) => lowerPath.includes(year))) return false;
  if (query.rootFilter === null) return true;
  return candidate.root.toLowerCase().includes(query.rootFilter) || lowerPath.includes(query.rootFilter);
};

/** Multi token AND: every token must match somewhere, the mean match class is the base score. */
export const scoreCandidate = (
  query: ParsedQuery,
  candidate: Candidate,
  context: ScoreContext,
): number => {
  if (!passesFilters(query, candidate)) return SCORE.none;
  if (query.tokens.length === 0) return SCORE.none;
  let sum = 0;
  for (const token of query.tokens) {
    const single = tokenScore(token, candidate);
    if (single === SCORE.none) return SCORE.none;
    sum += single;
  }
  const base = sum / query.tokens.length;
  const frecency = context.frecencyByPath.get(candidate.path) ?? 0;
  const underCwd =
    candidate.path !== context.cwd && candidate.path.startsWith(`${context.cwd}/`)
      ? BONUS.underCwd
      : 0;
  return base + frecencyBonus(frecency) + underCwd + brevityBonus(query, candidate);
};

/**
 * Relaxed, direction agnostic match used only to give the AI tier something to look at when
 * the strict matcher found nothing at all ("squashy" should still surface the "squash" dir).
 */
export const looseScore = (query: ParsedQuery, candidate: Candidate): number => {
  const name = candidate.name.toLowerCase();
  let best: number = SCORE.none;
  for (const token of query.tokens) {
    const forward = fuzzyScore(token, name);
    const backward = fuzzyScore(name, token);
    best = Math.max(best, forward, backward);
  }
  return best;
};

export const rankCandidates = (
  query: ParsedQuery,
  candidates: readonly Candidate[],
  context: ScoreContext,
): ScoredCandidate[] =>
  candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(query, candidate, context) }))
    .filter((scored) => scored.score > SCORE.none)
    .sort((a, b) => b.score - a.score || a.candidate.path.localeCompare(b.candidate.path));
