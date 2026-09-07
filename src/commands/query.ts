import { backendLabel, resolveAiBackend } from '../ai/backend.js';
import { askAi, type AiOutcome } from '../ai/client.js';
import { buildAiRequest } from '../ai/prompt.js';
import { loadConfig, type Config } from '../config.js';
import { LIMIT } from '../match/constants.js';
import { looseCandidates, resolveQuery, type Decision, type ResolveInput } from '../match/resolve.js';
import type { ScoredCandidate } from '../match/score.js';
import { tokenize, tokenizeArgs, type ParsedQuery } from '../match/tokenize.js';
import { contractTilde, isDirectory, isProtocolSafePath, isUnderRoot } from '../paths.js';
import { nativeCdWords, spelledPlace } from '../match/literal.js';
import { confirm, hasTty, pick, toItems } from '../picker.js';
import { EXIT, fail, jump, note, type ExitCode } from '../protocol.js';
import { ingest, type Db } from '../store/db.js';
import {
  findAlias,
  findAliasWhere,
  forgetAlias,
  rememberAlias,
  type IntentAlias,
} from '../store/aliases.js';
import { isStale, loadIndex, matchesConfig, refreshIndex, type DirIndex } from '../store/indexer.js';

const MILLIS_PER_SECOND = 1000;

interface QueryContext {
  readonly query: ParsedQuery;
  readonly config: Config;
  readonly db: Db;
  readonly nowSeconds: number;
  readonly input: ResolveInput;
  /** The shell can word this failure better than we can, so a miss says nothing at all. */
  readonly native: boolean;
}

const suggest = (
  ranked: readonly ScoredCandidate[],
  raw: string,
  native: boolean,
): ExitCode => {
  if (native) return EXIT.native;
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

const jumpKnown = (path: string): ExitCode => {
  if (!isProtocolSafePath(path)) {
    fail('matched path contains a line break unsupported by shell transport');
    return EXIT.error;
  }
  jump(path);
  return EXIT.ok;
};

const jumpExisting = (path: string): ExitCode => {
  if (!isDirectory(path)) {
    fail('matched directory no longer exists', 'run `cdai index --refresh`');
    return EXIT.error;
  }
  return jumpKnown(path);
};

/** The stopwords a query drops are exactly the words two typings of one intent disagree on. */
const aliasFor = (query: ParsedQuery): IntentAlias | undefined => {
  const exact = findAlias(query.raw);
  if (exact !== undefined) return exact;
  const phrase = query.tokens.join(' ');
  if (phrase === '') return undefined;
  return findAliasWhere((stored) => tokenize(stored).tokens.join(' ') === phrase);
};

const recalledAlias = (context: QueryContext): ExitCode | null => {
  const alias = aliasFor(context.query);
  if (alias === undefined) return null;
  const trusted = context.config.roots.some((root) => isUnderRoot(alias.path, root.path));
  if (trusted && isDirectory(alias.path)) return jumpKnown(alias.path);
  forgetAlias(alias.query);
  return null;
};

const acceptAi = (
  outcome: Extract<AiOutcome, { readonly kind: 'path' }>,
  context: QueryContext,
): ExitCode => {
  const label = outcome.reason === '' ? '' : ` (${outcome.reason})`;
  if (!confirm(`cdai: ${contractTilde(outcome.path)}${label}`)) return EXIT.noCd;
  rememberAlias(context.query.raw, outcome.path, context.nowSeconds);
  return jumpKnown(outcome.path);
};

const declineHeadlessAi = (): ExitCode => {
  note('cdai: AI confirmation requires a terminal [no terminal, declined]');
  return EXIT.noCd;
};

const aiTier = async (strict: readonly ScoredCandidate[], context: QueryContext): Promise<ExitCode> => {
  const { ai } = context.config;
  const ranked = strict.length > 0 ? strict : looseCandidates(context.query, context.input);
  if (!ai.enabled) return suggest(ranked, context.query.raw, context.native);
  if (!hasTty()) return context.native ? EXIT.native : declineHeadlessAi();
  const request = buildAiRequest({
    query: context.query.raw,
    cwd: process.cwd(),
    ranked,
    db: context.db,
    nowSeconds: context.nowSeconds,
    roots: context.config.roots.map((root) => root.path),
  });
  if (request.candidates.length === 0) return suggest(ranked, context.query.raw, context.native);
  const backend = resolveAiBackend(ai);
  if (backend === null) {
    const label = ai.command === 'auto' ? 'no supported AI backend found' : `${ai.command} unavailable`;
    note(`cdai: ${label}, staying deterministic`);
    return suggest(ranked, context.query.raw, context.native);
  }
  note(`cdai: thinking... (${backendLabel(backend)})`);
  const outcome = await askAi(request, backend, ai.timeoutMs);
  if (outcome.kind === 'none') {
    note(`cdai: ai had no usable answer (${outcome.why})`);
    return suggest(ranked, context.query.raw, context.native);
  }
  return acceptAi(outcome, context);
};

const retryFresh = async (context: QueryContext): Promise<ExitCode> => {
  const input = { ...context.input, index: refreshIndex(context.config) };
  const decision = resolveQuery(context.query, input);
  return finish(decision, { ...context, input }, true);
};

const finish = async (
  decision: Decision,
  context: QueryContext,
  refreshed: boolean,
): Promise<ExitCode> => {
  if (decision.kind === 'hit') {
    if (isDirectory(decision.path)) return jumpKnown(decision.path);
    return refreshed ? jumpExisting(decision.path) : retryFresh(context);
  }
  if (decision.kind === 'choose') {
    const chosen = pick(toItems(decision.candidates.map((c) => c.candidate.path)));
    if (chosen === null) return EXIT.noCd;
    if (isDirectory(chosen)) return jumpKnown(chosen);
    return refreshed ? jumpExisting(chosen) : retryFresh(context);
  }
  return aiTier(decision.candidates, context);
};

interface IndexState {
  readonly index: DirIndex;
  readonly refreshed: boolean;
}

const freshIndex = (config: Config): IndexState => {
  const index = loadIndex();
  if (matchesConfig(index, config)) return { index, refreshed: false };
  return { index: refreshIndex(config), refreshed: true };
};

interface SearchInput {
  readonly query: ParsedQuery;
  readonly config: Config;
}

const searchInput = (args: readonly string[], native: boolean): SearchInput | null => {
  const query = tokenizeArgs(args);
  if (query.tokens.length === 0) {
    if (!native) fail('nothing to search for', 'usage: cdai <words describing the directory>');
    return null;
  }
  const config = loadConfig();
  if (config.roots.length > 0) return { query, config };
  if (!native) fail('no roots configured', 'run `cdai setup` once to pick the directories to learn');
  return null;
};

export const runQuery = async (args: readonly string[]): Promise<ExitCode> => {
  const named = spelledPlace(args);
  if (named !== null) return jumpKnown(named);
  const native = nativeCdWords(args);
  const search = searchInput(args, native);
  if (search === null) return native ? EXIT.native : EXIT.error;
  const { query, config } = search;
  const db = ingest();
  const nowSeconds = Math.floor(Date.now() / MILLIS_PER_SECOND);
  const initial = freshIndex(config);
  let refreshed = initial.refreshed;
  let input: ResolveInput = { index: initial.index, db, cwd: process.cwd(), nowSeconds };
  let decision = resolveQuery(query, input);
  if (decision.kind === 'unsure') {
    const recalled = recalledAlias({ query, config, db, nowSeconds, input, native });
    if (recalled !== null) return recalled;
  }
  if (!refreshed && decision.kind === 'unsure' && isStale(input.index, Date.now())) {
    input = { ...input, index: refreshIndex(config) };
    refreshed = true;
    decision = resolveQuery(query, input);
  }
  return finish(decision, { query, config, db, nowSeconds, input, native }, refreshed);
};
