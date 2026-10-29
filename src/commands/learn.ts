import { join } from 'node:path';
import { contractTilde, writeAtomic } from '@franzenzenhofer/intent-core/paths';
import { confirm, hasTty } from '@franzenzenhofer/intent-core/picker';
import { emit } from '@franzenzenhofer/intent-core/protocol';
import { loadConfig, type Config } from '../config.js';
import type { LearnAnswer } from '../learn/answer.js';
import { askLearn, learnBackendLabel, resolveLearnBackend, LEARN_BACKENDS, type LearnBackendKind } from '../learn/backend.js';
import { buildDigest, knownPaths, type Digest } from '../learn/digest.js';
import { buildLearnPrompt } from '../learn/prompt.js';
import { renderReport, type VettedAlias } from '../learn/report.js';
import { EXIT, fail, note, type ExitCode } from '../protocol.js';
import { learnDir } from '../state.js';
import { rememberAlias } from '../store/aliases.js';
import { loadDecisions, type DecisionEntry } from '../store/decisions.js';
import { aliasRejection } from './alias.js';
import { allAliases, recallIntent } from './alias-recall.js';

/** A strong model reading a whole log takes minutes, not the seconds a jump gets. */
const LEARN_TIMEOUT_MS = 600_000;
const MILLIS_PER_SECOND = 1000;

export const LEARN_USAGE = [
  'usage:',
  '  cdai learn [--with claude|codex] [--model <name>]',
  '                            send the decision log to a local claude or codex CLI, print what',
  '                            it learned, offer its aliases one by one, keep the report',
  '  cdai learn --print-prompt print exactly what would be sent, and send nothing',
].join('\n');

interface LearnOptions {
  readonly backend: LearnBackendKind | null;
  readonly model: string;
  readonly printPrompt: boolean;
}

const isBackend = (value: string | undefined): value is LearnBackendKind =>
  LEARN_BACKENDS.some((kind) => kind === value);

export const parseLearnArgs = (args: readonly string[]): LearnOptions | null => {
  let backend: LearnBackendKind | null = null;
  let model = '';
  let printPrompt = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = args[i + 1];
    if (arg === '--print-prompt') printPrompt = true;
    else if (arg === '--with' && isBackend(value)) { backend = value; i += 1; }
    else if (arg === '--model' && value !== undefined && value.trim() !== '') { model = value; i += 1; }
    else return null;
  }
  return { backend, model, printPrompt };
};

/** Learned aliases obey the same closed set as the AI tier: only a directory the log itself named. */
const vet = (answer: LearnAnswer, entries: readonly DecisionEntry[], config: Config): VettedAlias[] => {
  const known = knownPaths(entries);
  return answer.aliases.map((alias) => {
    const refused = !known.has(alias.path) ? 'not a directory from the log'
      : recallIntent(alias.words, config) !== undefined ? 'those words already have an alias'
        : aliasRejection(alias.path);
    return { ...alias, refused, accepted: null };
  });
};

const offer = (aliases: readonly VettedAlias[]): VettedAlias[] => {
  if (!hasTty()) return [...aliases];
  return aliases.map((alias) => {
    if (alias.refused !== null) return alias;
    const accepted = confirm(`cdai: remember "${alias.words}" -> ${contractTilde(alias.path)}?`);
    if (accepted) rememberAlias(alias.words, alias.path, Math.floor(Date.now() / MILLIS_PER_SECOND));
    return { ...alias, accepted };
  });
};

const learn = async (options: LearnOptions): Promise<ExitCode> => {
  const entries = loadDecisions();
  if (entries.length === 0) {
    fail('nothing to learn from yet', 'the decision log fills as you use cdai; see `cdai log`');
    return EXIT.error;
  }
  const config = loadConfig();
  const existing = allAliases(config);
  const digest = buildDigest(entries, config, existing.map((a) => ({ words: a.query, path: a.path })));
  const prompt = buildLearnPrompt(digest);
  if (options.printPrompt) {
    emit(prompt);
    return EXIT.ok;
  }
  const backend = resolveLearnBackend(options.backend, options.model);
  if (backend === null) {
    fail(`${options.backend ?? 'neither claude nor codex'} found on PATH`, 'install Claude Code or the Codex CLI');
    return EXIT.error;
  }
  note(`cdai: sending ${digest.episodes.length} notable of ${entries.length} decisions to ${learnBackendLabel(backend)}...`);
  const answer = await askLearn(backend, prompt, LEARN_TIMEOUT_MS);
  return report(answer, { entries, digest, backend: learnBackendLabel(backend), config });
};

interface Learned {
  readonly entries: readonly DecisionEntry[];
  readonly digest: Digest;
  readonly backend: string;
  readonly config: Config;
}

/** stdout gets the report as suggested; the kept file also says what the person answered. */
const report = (answer: LearnAnswer, learned: Learned): ExitCode => {
  const at = new Date();
  const base = { at, backend: learned.backend, decisions: learned.entries.length, totals: learned.digest.totals, answer };
  const vetted = vet(answer, learned.entries, learned.config);
  emit(renderReport({ ...base, aliases: vetted }));
  const file = join(learnDir(), `learn-${at.toISOString().replace(/[:.]/g, '-')}.md`);
  writeAtomic(file, renderReport({ ...base, aliases: offer(vetted) }));
  note(`cdai: report kept at ${contractTilde(file)}`);
  return EXIT.ok;
};

export const runLearn = async (args: readonly string[]): Promise<ExitCode> => {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    note(LEARN_USAGE);
    return EXIT.ok;
  }
  const options = parseLearnArgs(args);
  if (options === null) {
    fail(`unknown learn arguments: ${args.join(' ')}`, LEARN_USAGE);
    return EXIT.error;
  }
  return learn(options);
};
