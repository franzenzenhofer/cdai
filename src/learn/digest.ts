import type { Config } from '../config.js';
import { normalizeIntent } from '../store/aliases.js';
import type { DecisionEntry, LoggedCandidate, LoggedQuestion } from '../store/decisions.js';

/**
 * Asked again this soon, after a miss or with a word in common, says the answer was not the place
 * meant. A quick jump somewhere unrelated is just the next errand, not a retry.
 */
export const RETRY_WINDOW_MS = 120_000;
/** The newest episodes worth reading, bounded so one prompt fits any backend's context. */
export const MAX_EPISODES = 150;
const MAX_TARGETS = 25;
const MAX_WORDINGS = 6;

export interface FollowUp {
  readonly words: string;
  readonly path: string | null;
  readonly afterSeconds: number;
}

/** One decision in the shape the model reads, plus what the person did right after it. */
export interface Episode {
  readonly at: string;
  readonly words: string;
  readonly outcome: string;
  readonly via: string;
  readonly path: string | null;
  readonly candidates: readonly LoggedCandidate[];
  readonly questions: readonly LoggedQuestion[];
  readonly ai: DecisionEntry['ai'];
  readonly then: FollowUp | null;
}

export interface Target {
  readonly path: string;
  readonly jumps: number;
  readonly wordings: readonly string[];
}

export interface Digest {
  readonly totals: Readonly<Record<string, number>>;
  readonly episodes: readonly Episode[];
  readonly targets: readonly Target[];
  readonly roots: Config['roots'];
  readonly aliases: readonly { readonly words: string; readonly path: string }[];
}

const countBy = (entries: readonly DecisionEntry[], key: (e: DecisionEntry) => string): Record<string, number> =>
  entries.reduce<Record<string, number>>((counts, entry) => {
    const name = key(entry);
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  }, {});

const wordsOf = (entry: DecisionEntry): Set<string> =>
  new Set(normalizeIntent(entry.words.join(' ')).split(' ').filter((word) => word !== ''));

const isRetry = (entry: DecisionEntry, next: DecisionEntry): boolean => {
  if (next.at - entry.at > RETRY_WINDOW_MS) return false;
  if (entry.outcome !== 'jump') return true;
  const earlier = wordsOf(entry);
  return next.path !== entry.path && [...wordsOf(next)].some((word) => earlier.has(word));
};

const followUp = (entry: DecisionEntry, next: DecisionEntry | undefined): FollowUp | null => {
  if (next === undefined || !isRetry(entry, next)) return null;
  return { words: next.words.join(' '), path: next.path, afterSeconds: Math.round((next.at - entry.at) / 1000) };
};

/** A clean hit with nothing after it taught nothing; everything else is worth a look. */
const isNotable = (episode: Episode): boolean =>
  episode.via !== 'hit' || episode.outcome !== 'jump' || episode.then !== null || episode.questions.length > 0;

const episodeOf = (entry: DecisionEntry, next: DecisionEntry | undefined): Episode => ({
  at: new Date(entry.at).toISOString(),
  words: entry.words.join(' '),
  outcome: entry.outcome,
  via: entry.via,
  path: entry.path,
  candidates: entry.candidates,
  questions: entry.questions,
  ai: entry.ai,
  then: followUp(entry, next),
});

const targetsOf = (entries: readonly DecisionEntry[]): Target[] => {
  const byPath = new Map<string, { jumps: number; wordings: Set<string> }>();
  for (const entry of entries) {
    if (entry.path === null) continue;
    const target = byPath.get(entry.path) ?? { jumps: 0, wordings: new Set<string>() };
    target.jumps += 1;
    if (target.wordings.size < MAX_WORDINGS) target.wordings.add(entry.words.join(' '));
    byPath.set(entry.path, target);
  }
  return [...byPath.entries()]
    .map(([path, t]) => ({ path, jumps: t.jumps, wordings: [...t.wordings] }))
    .sort((a, b) => b.jumps - a.jumps)
    .slice(0, MAX_TARGETS);
};

const totalsOf = (entries: readonly DecisionEntry[], episodes: readonly Episode[]): Record<string, number> => ({
  decisions: entries.length,
  ...Object.fromEntries(Object.entries(countBy(entries, (e) => e.outcome)).map(([k, v]) => [`outcome.${k}`, v])),
  ...Object.fromEntries(Object.entries(countBy(entries, (e) => e.via)).map(([k, v]) => [`via.${k}`, v])),
  aiCalls: entries.filter((e) => e.ai !== null).length,
  aiAnswered: entries.filter((e) => e.ai?.answered === true).length,
  retriedWithin2Min: episodes.filter((e) => e.then !== null).length,
});

/** The whole log reduced to what can teach something: counts, the notable episodes, the habits. */
export const buildDigest = (
  entries: readonly DecisionEntry[],
  config: Config,
  aliases: Digest['aliases'],
): Digest => {
  const episodes = entries.map((entry, i) => episodeOf(entry, entries[i + 1]));
  return {
    totals: totalsOf(entries, episodes),
    episodes: episodes.filter(isNotable).slice(-MAX_EPISODES),
    targets: targetsOf(entries),
    roots: config.roots,
    aliases,
  };
};

/** Every path the log itself names: the only directories a learned alias may point to. */
export const knownPaths = (entries: readonly DecisionEntry[]): Set<string> =>
  new Set(entries.flatMap((e) => [
    ...(e.path === null ? [] : [e.path]),
    ...e.candidates.map((c) => c.path),
    ...e.questions.flatMap((q) => q.options),
  ]));
