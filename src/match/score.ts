import { BONUS, COMPLETION, FUZZY, SCORE } from './constants.js';
import type { ParsedQuery } from './tokenize.js';

const SEGMENT_SPLIT = /[^a-z0-9]+/;
const LOG_BASE_2 = Math.LN2;

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
}

export interface ScoredCandidate {
  readonly candidate: Candidate;
  readonly score: number;
  /** Match class before contextual bonuses; stronger text matches always rank first. */
  readonly quality?: number;
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

interface EditInput {
  readonly token: string;
  readonly name: string;
  readonly nameLength: number;
}

const withinEdits = (input: EditInput, row: number, column: number, left: number): boolean => {
  while (row < input.token.length && column < input.nameLength
    && input.token[row] === input.name[column]) {
    row += 1;
    column += 1;
  }
  const tokenLeft = input.token.length - row;
  const nameLeft = input.nameLength - column;
  if (tokenLeft === 0 || nameLeft === 0) return Math.max(tokenLeft, nameLeft) <= left;
  if (left === 0 || Math.abs(tokenLeft - nameLeft) > left) return false;
  if (row + 1 < input.token.length && column + 1 < input.nameLength
    && input.token[row] === input.name[column + 1]
    && input.token[row + 1] === input.name[column]
    && withinEdits(input, row + 2, column + 2, left - 1)) return true;
  return withinEdits(input, row + 1, column + 1, left - 1)
    || withinEdits(input, row + 1, column, left - 1)
    || withinEdits(input, row, column + 1, left - 1);
};

const hasPrefixWithin = (token: string, name: string, edits: number): boolean => {
  const start = Math.max(1, token.length - edits);
  const end = Math.min(name.length, token.length + edits);
  for (let length = start; length <= end; length += 1) {
    if (withinEdits({ token, name, nameLength: length }, 0, 0, edits)) return true;
  }
  return false;
};

const typoScore = (token: string, name: string): number => {
  if (token.length < COMPLETION.minSmartLength || token.length > COMPLETION.maxTypoLength) return SCORE.none;
  if (token[0] !== name[0]) return SCORE.none;
  const allowance = token.length >= 8 ? 2 : 1;
  if (hasPrefixWithin(token, name, 1)) return SCORE.fuzzyMax - 40;
  return allowance === 2 && hasPrefixWithin(token, name, 2) ? SCORE.fuzzyMax - 80 : SCORE.none;
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
  const fuzzy = fuzzyScore(token, lower);
  return fuzzy > SCORE.none ? fuzzy : typoScore(token, lower);
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
  return quality + frecencyBonus(frecency) + underCwd + brevityBonus(query, candidate);
};

/**
 * Relaxed, direction agnostic match used only to give the AI tier something to look at when
 * the strict matcher found nothing at all ("squashy" should still surface the "squash" dir).
 * The backward direction is discounted by how much of the token the name actually spells, so a
 * generic four letter "site" cannot outrank "lumenlab-website" on the token "website".
 */
export const looseScore = (query: ParsedQuery, candidate: Candidate): number => {
  const name = candidate.name.toLowerCase();
  let best: number = SCORE.none;
  for (const token of query.tokens) {
    const forward = fuzzyScore(token, name);
    const shrink = token.length === 0 ? 0 : Math.min(1, name.length / token.length);
    const backward = fuzzyScore(name, token) * shrink;
    best = Math.max(best, forward, backward);
  }
  return Math.round(best);
};

export const rankCandidates = (
  query: ParsedQuery,
  candidates: readonly Candidate[],
  context: ScoreContext,
): ScoredCandidate[] =>
  candidates
    .map((candidate) => {
      const quality = matchQuality(query, candidate);
      return { candidate, quality, score: quality === SCORE.none
        ? SCORE.none : contextualScore(query, candidate, context, quality) };
    })
    .filter((scored) => scored.score > SCORE.none)
    .sort((a, b) => b.quality - a.quality || b.score - a.score
      || a.candidate.path.localeCompare(b.candidate.path));
