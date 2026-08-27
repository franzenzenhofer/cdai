import { basename, dirname } from 'node:path';
import { LIMIT, THRESHOLD } from './constants.js';
import {
  looseScore,
  rankCandidates,
  type Candidate,
  type ScoreContext,
  type ScoredCandidate,
} from './score.js';
import type { ParsedQuery } from './tokenize.js';
import type { DirIndex } from '../store/indexer.js';
import { childrenOf } from '../store/indexer.js';
import type { Db } from '../store/db.js';
import { frecency } from '../store/frecency.js';

export interface ResolveInput {
  readonly index: DirIndex;
  readonly db: Db;
  readonly cwd: string;
  readonly nowSeconds: number;
}

export type Decision =
  | { readonly kind: 'hit'; readonly path: string; readonly score: number }
  | { readonly kind: 'choose'; readonly candidates: readonly ScoredCandidate[] }
  | { readonly kind: 'unsure'; readonly candidates: readonly ScoredCandidate[] };

export const frecencyMap = (db: Db, nowSeconds: number): Map<string, number> =>
  new Map(db.records.map((record) => [record.path, frecency(record, nowSeconds)]));

/** Index entries plus every remembered path, so visited dirs outside the roots stay reachable. */
export const buildCandidates = (input: ResolveInput): Candidate[] => {
  const byPath = new Map<string, Candidate>();
  for (const entry of input.index.entries) byPath.set(entry.path, entry);
  for (const record of input.db.records) {
    if (byPath.has(record.path)) continue;
    byPath.set(record.path, { path: record.path, name: basename(record.path), mtime: 0, root: '' });
  }
  return [...byPath.values()];
};

const isChained = (a: string, b: string): boolean =>
  a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/**
 * A directory and its own ancestor are the same place, not two answers. Iterating score first
 * keeps the better scoring member of each chain and stops the picker firing on nested hits.
 */
export const collapseChains = (ranked: readonly ScoredCandidate[]): ScoredCandidate[] => {
  const kept: ScoredCandidate[] = [];
  for (const scored of ranked) {
    if (kept.some((k) => isChained(k.candidate.path, scored.candidate.path))) continue;
    kept.push(scored);
  }
  return kept;
};

/**
 * For ordered queries a candidate whose ancestor is also a contender is redundant: the
 * ancestor's children already represent it, and keeping it would pool its own children too
 * ("latest petalworks" must yield petalworks-2026, never dive into petalworks-2026's insides).
 */
export const dropDescendants = (ranked: readonly ScoredCandidate[]): ScoredCandidate[] => {
  const paths = new Set(ranked.map((r) => r.candidate.path));
  return ranked.filter((scored) => {
    let parent = dirname(scored.candidate.path);
    while (parent.length > 1) {
      if (paths.has(parent)) return false;
      parent = dirname(parent);
    }
    return true;
  });
};

const pickByMtime = (candidates: readonly Candidate[], newest: boolean): Candidate | undefined =>
  [...candidates].sort((a, b) => (newest ? b.mtime - a.mtime : a.mtime - b.mtime))[0];

/**
 * Children of every candidate that scores as well as the best one. Two equally named folders
 * in different roots are both plausible, so the year folder under either of them counts.
 */
const orderPool = (ranked: readonly ScoredCandidate[], index: DirIndex): Candidate[] => {
  const best = ranked[0];
  if (best === undefined) return [];
  const contenders = ranked.filter((r) => r.score >= best.score - THRESHOLD.gap);
  return contenders.flatMap((r) => childrenOf(index, r.candidate.path));
};

/** `latest`/`oldest`: prefer the extreme child of the best matches, else the extreme of the set. */
const applyOrder = (
  query: ParsedQuery,
  ranked: readonly ScoredCandidate[],
  index: DirIndex,
): Decision => {
  const best = ranked[0];
  if (best === undefined) return { kind: 'unsure', candidates: [] };
  const newest = query.order === 'latest';
  const children = orderPool(ranked, index);
  const pool = children.length > 0 ? children : ranked.map((r) => r.candidate);
  const chosen = pickByMtime(pool, newest);
  if (chosen === undefined) return { kind: 'unsure', candidates: ranked };
  return { kind: 'hit', path: chosen.path, score: best.score };
};

export const decide = (ranked: readonly ScoredCandidate[]): Decision => {
  const best = ranked[0];
  if (best === undefined) return { kind: 'unsure', candidates: [] };
  const runnerUp = ranked[1];
  const gap = best.score - (runnerUp?.score ?? 0);
  if (best.score >= THRESHOLD.hit && gap >= THRESHOLD.gap) {
    return { kind: 'hit', path: best.candidate.path, score: best.score };
  }
  const shortlist = ranked.filter((r) => r.score >= THRESHOLD.candidate).slice(0, LIMIT.picker);
  if (shortlist.length >= THRESHOLD.minPickerCandidates) {
    return { kind: 'choose', candidates: shortlist };
  }
  if (shortlist.length === 1 && best.score >= THRESHOLD.hit) {
    return { kind: 'hit', path: best.candidate.path, score: best.score };
  }
  return { kind: 'unsure', candidates: ranked.slice(0, LIMIT.aiFuzzy) };
};

/** Best guesses for the AI tier when the strict matcher came back empty handed. */
export const looseCandidates = (query: ParsedQuery, input: ResolveInput): ScoredCandidate[] =>
  buildCandidates(input)
    .map((candidate) => ({ candidate, score: looseScore(query, candidate) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.path.localeCompare(b.candidate.path))
    .slice(0, LIMIT.aiFuzzy);

export const resolveQuery = (query: ParsedQuery, input: ResolveInput): Decision => {
  const context: ScoreContext = {
    cwd: input.cwd,
    frecencyByPath: frecencyMap(input.db, input.nowSeconds),
  };
  if (query.order !== 'none') {
    // "latest X" is a filesystem question: rank without frecency or cwd bonuses so the
    // answer never changes with visit history or the directory the user happens to be in.
    const detached: ScoreContext = { cwd: '', frecencyByPath: new Map() };
    const ordered = dropDescendants(rankCandidates(query, buildCandidates(input), detached));
    if (ordered.length > 0) return applyOrder(query, ordered, input.index);
  }
  const ranked = collapseChains(rankCandidates(query, buildCandidates(input), context));
  return decide(ranked);
};
