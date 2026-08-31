import { collapseChains, buildCandidates, frecencyMap, type ResolveInput } from '../match/resolve.js';
import { THRESHOLD } from '../match/constants.js';
import { rankCandidates } from '../match/score.js';
import { tokenizeArgs } from '../match/tokenize.js';
import { EXIT, type ExitCode } from '../protocol.js';
import { loadDb } from '../store/db.js';
import { loadIndex } from '../store/indexer.js';

export const COMPLETION_LIMIT = 20;
const MILLIS_PER_SECOND = 1000;
const RECORD_SEPARATOR = /[\t\r\n]/;

const safeCandidates = (args: readonly string[], input: ResolveInput) => {
  const query = tokenizeArgs(args);
  if (query.tokens.length === 0) return [];
  const context = {
    cwd: input.cwd,
    frecencyByPath: frecencyMap(input.db, input.nowSeconds),
  };
  return collapseChains(rankCandidates(query, buildCandidates(input), context)).filter(
    ({ candidate, score }) =>
      score >= THRESHOLD.candidate && !RECORD_SEPARATOR.test(candidate.name),
  );
};

/** Shells quote the names; the resolver disambiguates identical names from different roots. */
export const completeQuery = (args: readonly string[], input: ResolveInput): string[] => {
  const ranked = safeCandidates(args, input);
  const names = ranked.map(({ candidate }) => candidate.name);
  return [...new Set(names)].slice(0, COMPLETION_LIMIT);
};

/** Machine-only completion endpoint: cached and deterministic, with no crawl, picker, or AI. */
export const runComplete = (args: readonly string[]): ExitCode => {
  const nowSeconds = Math.floor(Date.now() / MILLIS_PER_SECOND);
  const input = { index: loadIndex(), db: loadDb(), cwd: process.cwd(), nowSeconds };
  const matches = completeQuery(args, input);
  if (matches.length > 0) process.stdout.write(`${matches.join('\n')}\n`);
  return EXIT.ok;
};
