import { basename } from 'node:path';
import { LIMIT, THRESHOLD } from './constants.js';
import {
  looseScore,
  rankCandidates,
  type Candidate,
  type ScoreContext,
  type ScoredCandidate,
} from './score.js';
import { pathReading, termReading, urlReadings, type ParsedQuery } from './tokenize.js';
import type { CdaiRoot } from '../config.js';
import type { DirIndex } from '@franzenzenhofer/intent-core/store/indexer';
import { childrenOf } from '@franzenzenhofer/intent-core/store/indexer';
import type { Db } from '../store/db.js';
import { frecency } from '@franzenzenhofer/intent-core/store/frecency';
import {
  collapseChains as coreCollapseChains,
  decide as coreDecide,
  dropDescendants as coreDropDescendants,
  type DecideThresholds,
  type Scored,
} from '@franzenzenhofer/intent-core/match/decide';
import { isDirectory } from '@franzenzenhofer/intent-core/paths';

export interface ResolveInput {
  readonly index: DirIndex;
  readonly db: Db;
  readonly cwd: string;
  readonly nowSeconds: number;
  readonly roots: readonly CdaiRoot[];
}

export type Decision =
  | { readonly kind: 'hit'; readonly path: string; readonly score: number }
  | { readonly kind: 'choose'; readonly candidates: readonly ScoredCandidate[] }
  | { readonly kind: 'unsure'; readonly candidates: readonly ScoredCandidate[] };

/** cdai's own thresholds, handed to the shared decision rule. */
const THRESHOLDS: DecideThresholds = {
  ...THRESHOLD,
  picker: LIMIT.picker,
  unsure: LIMIT.aiFuzzy,
};

const asScored = (ranked: ScoredCandidate): Scored<Candidate> =>
  ({ item: ranked.candidate, quality: ranked.quality ?? ranked.score, score: ranked.score });

const asCandidate = (scored: Scored<Candidate>): ScoredCandidate =>
  ({ candidate: scored.item, quality: scored.quality, score: scored.score });

const pathOf = (candidate: Candidate): string => candidate.path;

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
export const collapseChains = (ranked: readonly ScoredCandidate[]): ScoredCandidate[] =>
  coreCollapseChains(ranked.map(asScored), pathOf).map(asCandidate);

/**
 * For ordered queries a candidate whose ancestor is also a contender is redundant: the
 * ancestor's children already represent it, and keeping it would pool its own children too
 * ("latest petalworks" must yield petalworks-2026, never dive into petalworks-2026's insides).
 */
export const dropDescendants = (ranked: readonly ScoredCandidate[]): ScoredCandidate[] =>
  coreDropDescendants(ranked.map(asScored), pathOf).map(asCandidate);

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
  const decision = coreDecide(ranked.map(asScored), THRESHOLDS);
  if (decision.kind === 'hit') return { kind: 'hit', path: decision.item.path, score: decision.score };
  return { kind: decision.kind, candidates: decision.candidates.map(asCandidate) };
};

/**
 * Every reading of the query, best understood first: an order word as part of the name it is
 * typed into, what was typed, the path it spells out, then its words as the names a link stands for.
 */
const readings = (query: ParsedQuery): ParsedQuery[] => {
  const term = termReading(query);
  const spelled = pathReading(query);
  return [...(term === null ? [] : [term]), query, ...(spelled === null ? [] : [spelled]), ...urlReadings(query)];
};

const weightsOf = (roots: readonly CdaiRoot[]): Map<string, number> =>
  new Map(roots.flatMap((root) => (root.weight === undefined || root.weight === 0 ? [] : [[root.path, root.weight]])));

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

/** Everything about this moment and this machine that ranks equal matches. */
export const scoreContext = (input: ResolveInput): ScoreContext => ({
  cwd: input.cwd,
  frecencyByPath: frecencyMap(input.db, input.nowSeconds),
  nowSeconds: input.nowSeconds,
  rootWeights: weightsOf(input.roots),
});

const resolveReading = (query: ParsedQuery, input: ResolveInput): Decision => {
  const context = scoreContext(input);
  if (query.order !== 'none') {
    // "latest X" is a filesystem question: rank without frecency or cwd bonuses so the
    // answer never changes with visit history or the directory the user happens to be in.
    const detached: ScoreContext = { ...context, cwd: '', frecencyByPath: new Map() };
    const ordered = dropDescendants(rankCandidates(query, buildCandidates(input), detached));
    if (ordered.length > 0) return applyOrder(query, ordered, input.index);
  }
  const ranked = collapseChains(rankCandidates(query, buildCandidates(input), context));
  return decide(ranked);
};

/**
 * A literal directory name always outranks a derived one. A folder can literally be called
 * "nordwind.at" or "mobile-first-workshops", so the typed words decide first and the derived
 * readings (an operator, a spelled path, a link) only speak when nothing answered at all.
 */
export const resolveQuery = (query: ParsedQuery, input: ResolveInput): Decision => {
  let unsure: Decision = { kind: 'unsure', candidates: [] };
  for (const reading of readings(query)) {
    const decision = resolveReading(reading, input);
    if (decision.kind !== 'unsure') return decision;
    if (unsure.kind === 'unsure' && unsure.candidates.length === 0) unsure = decision;
  }
  return unsure;
};
