import { existsSync, statSync } from 'node:fs';
import { collapseChains, buildCandidates, frecencyMap, type ResolveInput } from '../match/resolve.js';
import { THRESHOLD } from '../match/constants.js';
import { rankCandidates } from '../match/score.js';
import { tokenizeArgs } from '../match/tokenize.js';
import { EXIT, type ExitCode } from '../protocol.js';
import { loadConfig } from '../config.js';
import { loadDb } from '../store/db.js';
import { loadIndex, matchesConfig } from '../store/indexer.js';
import { stripCdOptions } from '../shell/control.js';

export const COMPLETION_LIMIT = 20;
const MILLIS_PER_SECOND = 1000;
const RECORD_SEPARATOR = /[\t\r\n]/;

const isDirectory = (path: string): boolean => {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const safeCandidates = (args: readonly string[], input: ResolveInput) => {
  const query = tokenizeArgs(stripCdOptions(args));
  if (query.tokens.length === 0) return [];
  const context = {
    cwd: input.cwd,
    frecencyByPath: frecencyMap(input.db, input.nowSeconds),
  };
  return collapseChains(rankCandidates(query, buildCandidates(input), context)).filter(
    ({ candidate, score }) =>
      score >= THRESHOLD.candidate &&
      !RECORD_SEPARATOR.test(candidate.name) &&
      (candidate.root !== '' || isDirectory(candidate.path)),
  );
};

/** Duplicate names expand to paths; a unique name stays concise and lets the resolver rank it. */
export const completeQuery = (args: readonly string[], input: ResolveInput): string[] => {
  const ranked = safeCandidates(args, input);
  const counts = new Map<string, number>();
  ranked.forEach(({ candidate }) => counts.set(candidate.name, (counts.get(candidate.name) ?? 0) + 1));
  const values = ranked.map(({ candidate }) =>
    counts.get(candidate.name) === 1 ? candidate.name : candidate.path,
  );
  return [...new Set(values)].slice(0, COMPLETION_LIMIT);
};

/** Machine-only completion endpoint: cached and deterministic, with no crawl, picker, or AI. */
export const runComplete = (args: readonly string[]): ExitCode => {
  const nowSeconds = Math.floor(Date.now() / MILLIS_PER_SECOND);
  const config = loadConfig();
  const index = loadIndex();
  if (!matchesConfig(index, config)) return EXIT.ok;
  const input = { index, db: loadDb(), cwd: process.cwd(), nowSeconds };
  const matches = completeQuery(args, input);
  if (matches.length > 0) process.stdout.write(`${matches.join('\n')}\n`);
  return EXIT.ok;
};
