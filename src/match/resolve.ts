import { basename, dirname } from 'node:path';
import { LIMIT, THRESHOLD } from './constants.js';
import {
  looseScore,
  rankCandidates,
  type Candidate,
  type ScoreContext,
  type ScoredCandidate,
} from './score.js';
import { hostReduced, type ParsedQuery } from './tokenize.js';
import type { DirIndex } from '../store/indexer.js';
import { childrenOf } from '../store/indexer.js';
import type { Db } from '../store/db.js';
import { frecency } from '../store/frecency.js';
import { PathChainSet } from './path-trie.js';
import { isDirectory } from '../paths.js';

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
  new Map(db.records.map((record) => [record.realPath ?? record.path, frecency(record, nowSeconds)]));

/**
 * Index entries plus every remembered path that still exists, so visited dirs outside the roots
 * stay reachable while deleted ones stay out of the answer. The index is a filesystem scan; the
 * db is memory, and a remembered directory can have been renamed, merged away or deleted. A dead
 * record used to reach the picker and turn a clean hit on its successor into a question. Only
 * records the index does not already cover are stat'd, so completion stays off the disk.
 */
export const buildCandidates = (input: ResolveInput): Candidate[] => {
  const byIdentity = new Map<string, Candidate>();
  for (const entry of input.index.entries) byIdentity.set(entry.realPath, entry);
  for (const record of input.db.records) {
    const identity = record.realPath ?? record.path;
    if (byIdentity.has(identity)) continue;
    if (!isDirectory(record.path)) continue;
    byIdentity.set(identity, {
      path: record.path,
      name: basename(record.path),
      mtime: 0,
      root: '',
      realPath: identity,
    });
  }
  return [...byIdentity.values()];
};

/**
 * A directory and its own ancestor are the same place, not two answers. Iterating score first
 * keeps the better scoring member of each chain and stops the picker firing on nested hits.
 */
export const collapseChains = (ranked: readonly ScoredCandidate[]): ScoredCandidate[] => {
  const kept: ScoredCandidate[] = [];
  const paths = new PathChainSet();
  for (const scored of ranked) {
    if (paths.hasChain(scored.candidate.path)) continue;
    kept.push(scored);
    paths.add(scored.candidate.path);
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
  const quality = best.quality ?? best.score;
  const contenders = ranked.filter((r) => (r.quality ?? r.score) >= quality - THRESHOLD.gap);
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
  const quality = best.quality ?? best.score;
  const runnerQuality = runnerUp?.quality ?? runnerUp?.score ?? 0;
  const gap = quality === runnerQuality
    ? best.score - (runnerUp?.score ?? 0)
    : quality - runnerQuality;
  if (quality >= THRESHOLD.hit && gap >= THRESHOLD.gap) {
    return { kind: 'hit', path: best.candidate.path, score: best.score };
  }
  const shortlist = ranked.filter((r) => (r.quality ?? r.score) >= THRESHOLD.candidate).slice(0, LIMIT.picker);
  if (shortlist.length >= THRESHOLD.minPickerCandidates) {
    return { kind: 'choose', candidates: shortlist };
  }
  if (shortlist.length === 1 && quality >= THRESHOLD.hit) {
    return { kind: 'hit', path: best.candidate.path, score: best.score };
  }
  return { kind: 'unsure', candidates: ranked.slice(0, LIMIT.aiFuzzy) };
};

/** Every reading of the query, best understood first: what was typed, then hosts as names. */
const readings = (query: ParsedQuery): ParsedQuery[] => {
  const reduced = hostReduced(query);
  return reduced === null ? [query] : [query, reduced];
};

/** Best guesses for the AI tier when the strict matcher came back empty handed. */
export const looseCandidates = (query: ParsedQuery, input: ResolveInput): ScoredCandidate[] => {
  const queries = readings(query);
  return buildCandidates(input)
    .map((candidate) => ({
      candidate,
      score: Math.max(...queries.map((reading) => looseScore(reading, candidate))),
    }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.path.localeCompare(b.candidate.path))
    .slice(0, LIMIT.aiFuzzy);
};

const resolveReading = (query: ParsedQuery, input: ResolveInput): Decision => {
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

/**
 * A literal directory name always outranks a derived one. "nordwind.at" is a real folder here, so
 * the typed word decides first and the host reading only speaks when nothing answered at all.
 */
export const resolveQuery = (query: ParsedQuery, input: ResolveInput): Decision => {
  const literal = resolveReading(query, input);
  if (literal.kind !== 'unsure') return literal;
  const reduced = hostReduced(query);
  if (reduced === null) return literal;
  const host = resolveReading(reduced, input);
  return host.kind === 'unsure' && host.candidates.length === 0 ? literal : host;
};
