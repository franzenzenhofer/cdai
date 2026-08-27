import { existsSync, statSync } from 'node:fs';
import { askAi } from '../ai/claude.js';
import { buildPrompt } from '../ai/prompt.js';
import { loadConfig, type Config } from '../config.js';
import { LIMIT } from '../match/constants.js';
import { looseCandidates, resolveQuery, type Decision, type ResolveInput } from '../match/resolve.js';
import type { ScoredCandidate } from '../match/score.js';
import { tokenizeArgs, type ParsedQuery } from '../match/tokenize.js';
import { absolutize, contractTilde } from '../paths.js';
import { confirm, findOnPath, pick, toItems } from '../picker.js';
import { EXIT, fail, jump, note, type ExitCode } from '../protocol.js';
import { ingest, type Db } from '../store/db.js';
import { isStale, loadIndex, refreshIndex, type DirIndex } from '../store/indexer.js';

const MILLIS_PER_SECOND = 1000;

interface QueryContext {
  readonly query: ParsedQuery;
  readonly config: Config;
  readonly db: Db;
  readonly nowSeconds: number;
  readonly input: ResolveInput;
}

const isDirectory = (path: string): boolean => {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const suggest = (ranked: readonly ScoredCandidate[], raw: string): ExitCode => {
  fail(`no match for "${raw}"`);
  const guesses = ranked.slice(0, LIMIT.suggestions);
  if (guesses.length === 0) {
    note('      try `cdai index --refresh`, or add a root with `cdai setup`');
    return EXIT.error;
  }
  note('      closest:');
  guesses.forEach((g) => note(`        ${contractTilde(g.candidate.path)}`));
  return EXIT.error;
};

const aiTier = async (strict: readonly ScoredCandidate[], context: QueryContext): Promise<ExitCode> => {
  const { ai } = context.config;
  const ranked = strict.length > 0 ? strict : looseCandidates(context.query, context.input);
  if (!ai.enabled) return suggest(strict, context.query.raw);
  if (findOnPath(ai.command) === null) {
    note(`cdai: ${ai.command} not on PATH, staying deterministic`);
    return suggest(strict, context.query.raw);
  }
  note(`cdai: thinking... (${ai.command} ${ai.model})`);
  const prompt = buildPrompt({
    query: context.query.raw,
    cwd: process.cwd(),
    ranked,
    db: context.db,
    nowSeconds: context.nowSeconds,
  });
  const outcome = await askAi(prompt, context.config);
  if (outcome.kind === 'none') {
    note(`cdai: ai had no usable answer (${outcome.why})`);
    return suggest(strict, context.query.raw);
  }
  const label = outcome.reason === '' ? '' : ` (${outcome.reason})`;
  if (!confirm(`cdai: ${contractTilde(outcome.path)}${label}`)) return EXIT.noCd;
  jump(outcome.path);
  return EXIT.ok;
};

const finish = async (decision: Decision, context: QueryContext): Promise<ExitCode> => {
  if (decision.kind === 'hit') {
    jump(decision.path);
    return EXIT.ok;
  }
  if (decision.kind === 'choose') {
    const chosen = pick(toItems(decision.candidates.map((c) => c.candidate.path)));
    if (chosen === null) return EXIT.noCd;
    jump(chosen);
    return EXIT.ok;
  }
  return aiTier(decision.candidates, context);
};

const freshIndex = (config: Config): DirIndex => {
  const index = loadIndex();
  return index.entries.length === 0 ? refreshIndex(config) : index;
};

export const runQuery = async (args: readonly string[]): Promise<ExitCode> => {
  const first = args[0];
  if (args.length === 1 && first !== undefined && isDirectory(absolutize(first))) {
    jump(absolutize(first));
    return EXIT.ok;
  }
  const query = tokenizeArgs(args);
  if (query.tokens.length === 0) {
    fail('nothing to search for', 'usage: cdai <words describing the directory>');
    return EXIT.error;
  }
  const config = loadConfig();
  if (config.roots.length === 0) {
    fail('no roots configured', 'run `cdai setup` once to pick the directories to learn');
    return EXIT.error;
  }
  const db = ingest();
  const nowSeconds = Math.floor(Date.now() / MILLIS_PER_SECOND);
  let input: ResolveInput = { index: freshIndex(config), db, cwd: process.cwd(), nowSeconds };
  let decision = resolveQuery(query, input);
  if (decision.kind === 'unsure' && isStale(input.index, Date.now())) {
    input = { ...input, index: refreshIndex(config) };
    decision = resolveQuery(query, input);
  }
  return finish(decision, { query, config, db, nowSeconds, input });
};
