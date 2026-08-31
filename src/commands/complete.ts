import { existsSync, statSync } from 'node:fs';
import { collapseChains, buildCandidates, frecencyMap, type ResolveInput } from '../match/resolve.js';
import { rankCandidates, type ScoredCandidate } from '../match/score.js';
import {
  completionKindRank,
  smartNameMatch,
  type CompletionMatch,
} from '../match/completion.js';
import { tokenizeArgs } from '../match/tokenize.js';
import { STOPWORDS } from '../match/constants.js';
import { EXIT, type ExitCode } from '../protocol.js';
import { loadConfig } from '../config.js';
import { loadDb } from '../store/db.js';
import { loadIndex, matchesConfig } from '../store/indexer.js';
import { CLI_CONTROLS, stripCdOptions } from '../shell/control.js';
import { loadAliases } from '../store/aliases.js';
import { completeAliasWords, completeRootNames } from './completion-aliases.js';

export const COMPLETION_LIMIT = 20;
const MILLIS_PER_SECOND = 1000;
const CLI_CONTROL_SET = new Set<string>(CLI_CONTROLS);
const FUZZY_LIMIT = 5;
const VALIDATION_ATTEMPT_LIMIT = 512;

const isDirectory = (path: string): boolean => {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const hasUnsafeCompletionChar = (value: string): boolean =>
  [...value].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });

const safelyMerge = (args: readonly string[], matches: readonly string[]): string[] => {
  const unique = [...new Set(matches)];
  if (unique.length <= 1) return unique;
  const active = stripCdOptions(args).at(-1)?.toLowerCase() ?? '';
  return unique.filter((match) => match.toLowerCase().startsWith(active));
};

interface CompletionCandidate extends ScoredCandidate {
  readonly completion: CompletionMatch;
}

interface CompletionSet {
  readonly candidates: readonly CompletionCandidate[];
  readonly nameCounts: ReadonlyMap<string, number>;
}

const nameMatch = (fragments: readonly string[], name: string): CompletionMatch | undefined =>
  fragments.map((fragment) => smartNameMatch(fragment, name))
    .filter((match): match is CompletionMatch => match !== undefined)
    .sort((a, b) => completionKindRank(b.kind) - completionKindRank(a.kind)
      || b.strength - a.strength)[0];

const liveCandidates = (ranked: readonly CompletionCandidate[]): CompletionCandidate[] => {
  const live: CompletionCandidate[] = [];
  for (const candidate of ranked.slice(0, VALIDATION_ATTEMPT_LIMIT)) {
    if (isDirectory(candidate.candidate.path)) live.push(candidate);
    if (live.length >= COMPLETION_LIMIT) break;
  }
  return live;
};

const safeCandidates = (args: readonly string[], input: ResolveInput): CompletionSet => {
  const words = stripCdOptions(args);
  if (words.some((word) => word.includes('/') || word.startsWith('~'))) {
    return { candidates: [], nameCounts: new Map() };
  }
  const query = tokenizeArgs(words);
  if (query.tokens.length === 0) return { candidates: [], nameCounts: new Map() };
  const context = { cwd: input.cwd, frecencyByPath: frecencyMap(input.db, input.nowSeconds) };
  const active = words.at(-1)?.toLowerCase() ?? '';
  const ranked = collapseChains(rankCandidates(query, buildCandidates(input), context));
  const activeMatches = STOPWORDS.has(active) ? [] : ranked
    .map((scored) => ({ ...scored, completion: smartNameMatch(active, scored.candidate.name) }))
    .filter((item): item is CompletionCandidate => item.completion !== undefined);
  const matched = activeMatches.length > 0 ? activeMatches : ranked
    .map((scored) => ({ ...scored, completion: nameMatch(query.tokens, scored.candidate.name) }))
    .filter((item): item is CompletionCandidate => item.completion !== undefined);
  const ordered = matched
    .filter(({ candidate }) => !hasUnsafeCompletionChar(candidate.name)
      && !hasUnsafeCompletionChar(candidate.path))
    .sort((a, b) => completionKindRank(b.completion.kind) - completionKindRank(a.completion.kind)
      || b.completion.strength - a.completion.strength
      || (b.quality ?? b.score) - (a.quality ?? a.score) || b.score - a.score
      || a.candidate.path.localeCompare(b.candidate.path));
  const nameCounts = new Map<string, number>();
  ordered.forEach(({ candidate }) =>
    nameCounts.set(candidate.name, (nameCounts.get(candidate.name) ?? 0) + 1));
  return { candidates: liveCandidates(ordered), nameCounts };
};

/** Duplicate names expand to paths; a unique name stays concise and lets the resolver rank it. */
export const completeQuery = (args: readonly string[], input: ResolveInput): string[] => {
  const intentWords = stripCdOptions(args).length;
  const safe = safeCandidates(args, input);
  const best = safe.candidates[0]?.completion;
  const ranked = safe.candidates.filter((item) => best !== undefined
      && completionKindRank(item.completion.kind) === completionKindRank(best.kind)
      && item.completion.strength === best.strength)
    .slice(0, best?.kind === 'literal' ? COMPLETION_LIMIT : FUZZY_LIMIT);
  const values = ranked.map(({ candidate }) => {
    const count = safe.nameCounts.get(candidate.name) ?? 0;
    if (intentWords === 1 && count > 1 && CLI_CONTROL_SET.has(candidate.name)) return undefined;
    const reserved = intentWords === 1 && count === 1 && CLI_CONTROL_SET.has(candidate.name);
    return reserved ? candidate.path : candidate.name;
  }).filter((value): value is string => value !== undefined);
  return safelyMerge(args, values).slice(0, COMPLETION_LIMIT);
};

/** Machine-only completion endpoint: cached and deterministic, with no crawl, picker, or AI. */
export const runComplete = (args: readonly string[]): ExitCode => {
  const nowSeconds = Math.floor(Date.now() / MILLIS_PER_SECOND);
  const config = loadConfig();
  const roots = completeRootNames(args, config);
  const aliases = loadAliases().aliases.filter((alias) => isDirectory(alias.path));
  const remembered = completeAliasWords(args, aliases, config)
    .filter((word) => !hasUnsafeCompletionChar(word));
  const index = loadIndex();
  const indexed = matchesConfig(index, config)
    ? completeQuery(args, { index, db: loadDb(), cwd: process.cwd(), nowSeconds })
    : [];
  const reserved = remembered.slice(0, FUZZY_LIMIT);
  const indexedLimit = COMPLETION_LIMIT - reserved.length;
  const combined = roots ?? [...indexed.slice(0, indexedLimit), ...reserved];
  const matches = safelyMerge(args, combined);
  if (matches.length > 0) process.stdout.write(`${matches.join('\n')}\n`);
  return EXIT.ok;
};
