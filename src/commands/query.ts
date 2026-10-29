import { loadConfig, type Config } from '../config.js';
import { resolveQuery, type Decision, type ResolveInput } from '../match/resolve.js';
import { tokenizeArgs, type ParsedQuery } from '../match/tokenize.js';
import { configFile, contractTilde, isDirectory, isUnderRoot } from '@franzenzenhofer/intent-core/paths';
import { recallIntent } from './alias-recall.js';
import { nativeCdWords, spelledPlace } from '../match/literal.js';
import { pick, toItems } from '@franzenzenhofer/intent-core/picker';
import { EXIT, fail, type ExitCode } from '../protocol.js';
import { ingest } from '../store/db.js';
import { forgetAlias } from '../store/aliases.js';
import { loadIndex, matchesConfig, refreshIndex, type DirIndex } from '@franzenzenhofer/intent-core/store/indexer';
import { jumpExisting, jumpKnown } from './jump.js';
import { aiTier, type QueryContext } from './query-ai.js';
import { startTrace, type Trace } from './trace.js';
import packageJson from '../../package.json' with { type: 'json' };

const MILLIS_PER_SECOND = 1000;

/**
 * A named directory is the answer before any matcher guesses. A broken config alias is the
 * user's own file being wrong, so it is reported rather than skipped; a taught one whose target
 * vanished or left the roots is forgotten and the search goes on.
 */
const recalledAlias = (query: ParsedQuery, config: Config, trace: Trace): ExitCode | null => {
  const alias = recallIntent(query.raw, config);
  if (alias === undefined) return null;
  if (alias.source === 'config') {
    trace.via('config-alias', alias.path);
    if (isDirectory(alias.path)) return jumpKnown(alias.path);
    fail(`config alias "${alias.query}" points to a missing directory: ${contractTilde(alias.path)}`,
      `fix or remove it in ${configFile()}`);
    return EXIT.error;
  }
  const trusted = config.roots.some((root) => isUnderRoot(alias.path, root.path));
  if (trusted && isDirectory(alias.path)) {
    trace.via('taught-alias', alias.path);
    return jumpKnown(alias.path);
  }
  forgetAlias(alias.query);
  return null;
};

const retryFresh = async (context: QueryContext): Promise<ExitCode> => {
  const input = { ...context.input, index: refreshIndex(context.config) };
  context.trace.rescanned();
  const decision = resolveQuery(context.query, input);
  return finish(decision, { ...context, input }, true);
};

const finish = async (
  decision: Decision,
  context: QueryContext,
  refreshed: boolean,
): Promise<ExitCode> => {
  if (decision.kind === 'hit') {
    context.trace.hit(decision.path, decision.score);
    if (isDirectory(decision.path)) return jumpKnown(decision.path);
    return refreshed ? jumpExisting(decision.path) : retryFresh(context);
  }
  context.trace.ranked(decision.candidates);
  if (decision.kind === 'choose') {
    const options = decision.candidates.map((c) => c.candidate.path);
    const chosen = pick(toItems(options));
    context.trace.asked({ kind: 'picker', options, answer: chosen });
    if (chosen === null) return EXIT.noCd;
    context.trace.via('picker', chosen);
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

const resolveIntent = async (args: readonly string[], trace: Trace): Promise<ExitCode> => {
  const named = spelledPlace(args);
  if (named !== null) {
    trace.via('path', named);
    return jumpKnown(named);
  }
  const native = nativeCdWords(args);
  const search = searchInput(args, native);
  if (search === null) return native ? EXIT.native : EXIT.error;
  const { query, config } = search;
  const recalled = recalledAlias(query, config, trace);
  if (recalled !== null) return recalled;
  const db = ingest();
  const nowSeconds = Math.floor(Date.now() / MILLIS_PER_SECOND);
  const initial = freshIndex(config);
  let refreshed = initial.refreshed;
  let input: ResolveInput = { index: initial.index, db, cwd: process.cwd(), nowSeconds, roots: config.roots };
  let decision = resolveQuery(query, input);
  // Nothing answered, so the one thing that can change the answer is data we do not have yet.
  // A folder made since the last scan is invisible however recent that scan was, and rebuilding
  // it costs a fraction of the AI call it precedes - so this is a rescan, never a question.
  if (!refreshed && decision.kind === 'unsure') {
    input = { ...input, index: refreshIndex(config) };
    refreshed = true;
    trace.rescanned();
    decision = resolveQuery(query, input);
  }
  return finish(decision, { query, config, db, nowSeconds, input, native, trace }, refreshed);
};

/** A broken config.json is already reported by the query itself, so it never also blocks the log. */
const logEnabled = (): boolean => {
  try {
    return loadConfig().log;
  } catch {
    return false;
  }
};

/** Every query leaves one line in the decision log, whatever it ends in. See commands/trace.ts. */
export const runQuery = async (args: readonly string[]): Promise<ExitCode> => {
  const { trace, finish: record } = startTrace(args, packageJson.version, logEnabled);
  try {
    const code = await resolveIntent(args, trace);
    record(code, null);
    return code;
  } catch (error) {
    record(EXIT.error, error instanceof Error ? error.message : String(error));
    throw error;
  }
};
