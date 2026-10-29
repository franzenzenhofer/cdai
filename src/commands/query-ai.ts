import { backendLabel, resolveAiBackend, type AiBackend } from '@franzenzenhofer/intent-core/ai/backend';
import { askAi, type AiOutcome, type AiRequest } from '../ai/client.js';
import { buildAiRequest } from '../ai/prompt.js';
import type { Config } from '../config.js';
import { LIMIT } from '../match/constants.js';
import { looseCandidates, type ResolveInput } from '../match/resolve.js';
import type { ScoredCandidate } from '../match/score.js';
import type { ParsedQuery } from '../match/tokenize.js';
import { contractTilde } from '@franzenzenhofer/intent-core/paths';
import { confirm, hasTty } from '@franzenzenhofer/intent-core/picker';
import { EXIT, fail, note, type ExitCode } from '../protocol.js';
import type { Db } from '../store/db.js';
import { rememberAlias } from '../store/aliases.js';
import { jumpKnown } from './jump.js';
import type { Trace } from './trace.js';

export interface QueryContext {
  readonly query: ParsedQuery;
  readonly config: Config;
  readonly db: Db;
  readonly nowSeconds: number;
  readonly input: ResolveInput;
  /** The shell can word this failure better than we can, so a miss says nothing at all. */
  readonly native: boolean;
  readonly trace: Trace;
}

/**
 * The last word, and the only place a rescan is not the answer: this is reached with a freshly
 * built index behind it, so the scope of that scan is the useful thing to report - a place it
 * never looked cannot be found by looking again.
 */
const suggest = (ranked: readonly ScoredCandidate[], context: QueryContext): ExitCode => {
  if (context.native) return EXIT.native;
  fail(`no match for "${context.query.raw}"`);
  const guesses = ranked.slice(0, LIMIT.suggestions);
  if (guesses.length > 0) {
    note('      closest:');
    guesses.forEach((g) => note(`        ${contractTilde(g.candidate.path)}`));
  }
  const roots = context.config.roots.length;
  const scanned = context.input.index.entries.length;
  note(`      searched ${scanned} directories under ${roots} ${roots === 1 ? 'root' : 'roots'}, freshly scanned`);
  note('      not there? `cdai setup --root <path>`, or reach deeper with `--depth <n>`');
  return EXIT.error;
};

/** One question to the model, with what it was offered and what it said written to the trace. */
const askTraced = async (request: AiRequest, backend: AiBackend, context: QueryContext): Promise<AiOutcome> => {
  note(`cdai: thinking... (${backendLabel(backend)})`);
  const startedAt = Date.now();
  const outcome = await askAi(request, backend, context.config.ai.timeoutMs);
  context.trace.ai({
    backend: backendLabel(backend),
    answered: outcome.kind === 'path',
    note: outcome.kind === 'path' ? outcome.reason : outcome.why,
    offered: request.candidates.length,
    ms: Date.now() - startedAt,
  });
  return outcome;
};

const acceptAi = (
  outcome: Extract<AiOutcome, { readonly kind: 'path' }>,
  context: QueryContext,
): ExitCode => {
  const label = outcome.reason === '' ? '' : ` (${outcome.reason})`;
  const accepted = confirm(`cdai: ${contractTilde(outcome.path)}${label}`);
  context.trace.asked({ kind: 'confirm', options: [outcome.path], answer: accepted ? outcome.path : null });
  if (!accepted) return EXIT.noCd;
  context.trace.via('ai', outcome.path);
  rememberAlias(context.query.raw, outcome.path, context.nowSeconds);
  return jumpKnown(outcome.path);
};

const declineHeadlessAi = (): ExitCode => {
  note('cdai: AI confirmation requires a terminal [no terminal, declined]');
  return EXIT.noCd;
};

export const aiTier = async (strict: readonly ScoredCandidate[], context: QueryContext): Promise<ExitCode> => {
  const { ai } = context.config;
  const ranked = strict.length > 0 ? strict : looseCandidates(context.query, context.input);
  context.trace.ranked(ranked);
  if (!ai.enabled) return suggest(ranked, context);
  if (!hasTty()) return context.native ? EXIT.native : declineHeadlessAi();
  const request = buildAiRequest({
    query: context.query.raw,
    cwd: process.cwd(),
    ranked,
    db: context.db,
    nowSeconds: context.nowSeconds,
    roots: context.config.roots.map((root) => root.path),
  });
  if (request.candidates.length === 0) return suggest(ranked, context);
  const backend = resolveAiBackend(ai);
  if (backend === null) {
    const label = ai.command === 'auto' ? 'no supported AI backend found' : `${ai.command} unavailable`;
    note(`cdai: ${label}, staying deterministic`);
    return suggest(ranked, context);
  }
  const outcome = await askTraced(request, backend, context);
  if (outcome.kind === 'none') {
    note(`cdai: ai had no usable answer (${outcome.why})`);
    return suggest(ranked, context);
  }
  return acceptAi(outcome, context);
};
