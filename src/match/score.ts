import {
  fuzzyScore as coreFuzzyScore,
  frecencyBonus as coreFrecencyBonus,
  looseScore as coreLooseScore,
  matchName as coreMatchName,
  type MatchOptions,
} from '@franzenzenhofer/intent-core/match/score';
import { rank, type Scored } from '@franzenzenhofer/intent-core/match/decide';
import { BONUS, COMPLETION, FUZZY, RECENCY, SCORE } from './constants.js';
import type { ParsedQuery } from './tokenize.js';

/**
 * How cdai wants names compared. The primitives live in the shared core; the numbers that make
 * a matcher feel right are a product decision, and these are cdai's.
 */
export const MATCH: MatchOptions = {
  weights: SCORE,
  fuzzy: FUZZY,
  typo: { minLength: COMPLETION.minSmartLength, maxLength: COMPLETION.maxTypoLength },
};

export interface Candidate {
  readonly path: string;
  readonly name: string;
  readonly mtime: number;
  readonly root: string;
  readonly realPath?: string;
}

export interface ScoreContext {
  readonly cwd: string;
  readonly frecencyByPath: ReadonlyMap<string, number>;
  readonly nowSeconds: number;
  /** Configured root path to its weight, only for roots that have one. */
  readonly rootWeights: ReadonlyMap<string, number>;
}

const SECONDS_PER_DAY = 86_400;
const MILLIS_PER_SECOND = 1000;

export interface ScoredCandidate {
  readonly candidate: Candidate;
  readonly score: number;
  /** Match class before contextual bonuses; stronger text matches always rank first. */
  readonly quality?: number;
}

/** Longest run bonus for a subsequence match, 0 when the token is not a subsequence at all. */
export const fuzzyScore = (token: string, name: string): number =>
  coreFuzzyScore(token, name, MATCH);

/** Match class of a single token against a single directory name. */
export const matchName = (token: string, name: string): number =>
  coreMatchName(token, name, MATCH);

export const frecencyBonus = (frecency: number): number =>
  coreFrecencyBonus(frecency, BONUS.frecency);

const parentPath = (path: string): string => {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '' : path.slice(0, idx);
};

const tokenScore = (token: string, candidate: Candidate): number => {
  const nameScore = matchName(token, candidate.name);
  if (nameScore > SCORE.none) return nameScore;
  return parentPath(candidate.path).toLowerCase().includes(token) ? SCORE.pathOnly : SCORE.none;
};

const brevityBonus = (query: ParsedQuery, candidate: Candidate): number => {
  const queried = query.tokens.reduce((sum, token) => sum + token.length, 0);
  if (queried === 0 || candidate.name.length === 0) return 0;
  return BONUS.brevity * Math.min(1, queried / candidate.name.length);
};

/** Index mtimes are milliseconds; a remembered-only directory has none and earns nothing. */
export const recencyBonus = (mtimeMs: number, nowSeconds: number): number => {
  if (mtimeMs <= 0) return 0;
  const ageDays = Math.max(0, nowSeconds - mtimeMs / MILLIS_PER_SECOND) / SECONDS_PER_DAY;
  return BONUS.recency * 2 ** (-ageDays / RECENCY.halfLifeDays);
};

/** The weight of the root a candidate was indexed under, or of the root it lives in. */
export const rootWeight = (candidate: Candidate, weights: ReadonlyMap<string, number>): number => {
  if (weights.size === 0) return 0;
  const indexed = weights.get(candidate.root);
  if (indexed !== undefined) return indexed;
  for (const [root, weight] of weights) {
    if (candidate.path === root || candidate.path.startsWith(`${root}/`)) return weight;
  }
  return 0;
};

const passesFilters = (query: ParsedQuery, candidate: Candidate): boolean => {
  const lowerPath = candidate.path.toLowerCase();
  if (!query.years.every((year) => lowerPath.includes(year))) return false;
  if (!query.within.every((folder) => lowerPath.includes(folder))) return false;
  if (query.rootFilter === null) return true;
  return candidate.root.toLowerCase().includes(query.rootFilter) || lowerPath.includes(query.rootFilter);
};

/** Multi token AND: every token must match somewhere, the mean match class is the base score. */
export const matchQuality = (query: ParsedQuery, candidate: Candidate): number => {
  if (!passesFilters(query, candidate)) return SCORE.none;
  if (query.tokens.length === 0) return SCORE.none;
  let sum = 0;
  for (const token of query.tokens) {
    const single = tokenScore(token, candidate);
    if (single === SCORE.none) return SCORE.none;
    sum += single;
  }
  return sum / query.tokens.length;
};

export const scoreCandidate = (
  query: ParsedQuery,
  candidate: Candidate,
  context: ScoreContext,
): number => {
  const quality = matchQuality(query, candidate);
  if (quality === SCORE.none) return SCORE.none;
  return contextualScore(query, candidate, context, quality);
};

const contextualScore = (
  query: ParsedQuery,
  candidate: Candidate,
  context: ScoreContext,
  quality: number,
): number => {
  const frecency = context.frecencyByPath.get(candidate.realPath ?? candidate.path) ?? 0;
  const underCwd =
    candidate.path !== context.cwd && candidate.path.startsWith(`${context.cwd}/`)
      ? BONUS.underCwd
      : 0;
  return quality + frecencyBonus(frecency) + underCwd + brevityBonus(query, candidate)
    + recencyBonus(candidate.mtime, context.nowSeconds) + rootWeight(candidate, context.rootWeights);
};

/**
 * Relaxed, direction agnostic match used only to give the AI tier something to look at when
 * the strict matcher found nothing at all ("squashy" should still surface the "squash" dir).
 * The backward direction is discounted by how much of the token the name actually spells, so a
 * generic four letter "site" cannot outrank "lumenlab-website" on the token "website".
 */
export const looseScore = (query: ParsedQuery, candidate: Candidate): number =>
  coreLooseScore(query.tokens, candidate.name, MATCH);

export const rankCandidates = (
  query: ParsedQuery,
  candidates: readonly Candidate[],
  context: ScoreContext,
): ScoredCandidate[] =>
  rank<Candidate>(
    candidates,
    (candidate) => {
      const quality = matchQuality(query, candidate);
      if (quality === SCORE.none) return null;
      return { quality, score: contextualScore(query, candidate, context, quality) };
    },
    (a, b) => a.path.localeCompare(b.path),
  ).map((scored: Scored<Candidate>) => ({
    candidate: scored.item, quality: scored.quality, score: scored.score,
  }));
