import { contractTilde } from '@franzenzenhofer/intent-core/paths';
import { emit } from '@franzenzenhofer/intent-core/protocol';
import { loadConfig } from '../config.js';
import { EXIT, fail, note, type ExitCode } from '../protocol.js';
import { decisionsLog } from '../state.js';
import { loadDecisions, type DecisionEntry, type LoggedQuestion } from '../store/decisions.js';

const DEFAULT_COUNT = 20;
const MAX_COUNT = 100_000;
const TIME_WIDTH = '2026-01-01 00:00'.length;

export const LOG_USAGE = [
  'usage:',
  '  cdai log [-n <count>]     the latest decisions, newest last (default 20)',
  '  cdai log --json [-n <n>]  the same entries as JSON lines',
  '  cdai log path             print only the log file path',
].join('\n');

interface LogOptions {
  readonly count: number;
  readonly json: boolean;
}

const readCount = (value: string | undefined): number | null => {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const count = Number(value);
  return count >= 1 && count <= MAX_COUNT ? count : null;
};

export const parseLogArgs = (args: readonly string[]): LogOptions | null => {
  let count = DEFAULT_COUNT;
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') json = true;
    else if (arg === '-n') {
      const parsed = readCount(args[i + 1]);
      if (parsed === null) return null;
      count = parsed;
      i += 1;
    } else return null;
  }
  return { count, json };
};

const two = (n: number): string => String(n).padStart(2, '0');

/** Local time, because that is the clock the person remembers the jump by. */
const when = (at: number): string => {
  const d = new Date(at);
  return `${String(d.getFullYear())}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

const describeQuestion = (question: LoggedQuestion): string => {
  if (question.kind === 'confirm') return `asked to confirm, ${question.answer === null ? 'declined' : 'confirmed'}`;
  const answer = question.answer === null ? 'aborted' : `chose ${contractTilde(question.answer)}`;
  return `picker of ${String(question.options.length)}, ${answer}`;
};

/** One decision as a person reads it: when, how it ended, how it got there, and the words. */
export const describeDecision = (entry: DecisionEntry): string[] => {
  const target = entry.path === null ? '' : ` -> ${contractTilde(entry.path)}`;
  const lines = [`${when(entry.at)}  ${entry.outcome.padEnd(6)} ${entry.via.padEnd(12)} "${entry.words.join(' ')}"${target}  (${entry.ms}ms)`];
  const pad = ' '.repeat(TIME_WIDTH + 2);
  if (entry.rescanned) lines.push(`${pad}rescanned the index`);
  entry.questions.forEach((question) => lines.push(`${pad}${describeQuestion(question)}`));
  if (entry.ai !== null) {
    const said = entry.ai.answered ? `chose, "${entry.ai.note}"` : `no answer, ${entry.ai.note}`;
    lines.push(`${pad}ai ${entry.ai.backend}: ${said} (${entry.ai.offered} offered, ${entry.ai.ms}ms)`);
  }
  if (entry.error !== null) lines.push(`${pad}error: ${entry.error}`);
  return lines;
};

const show = (options: LogOptions): ExitCode => {
  const entries = loadDecisions().slice(-options.count);
  if (options.json) {
    entries.forEach((entry) => emit(JSON.stringify(entry)));
    return EXIT.ok;
  }
  note(`cdai: ${entries.length} decisions from ${contractTilde(decisionsLog())}`);
  if (!loadConfig().log) note('cdai: logging is off ("log": false in config.json)');
  entries.flatMap(describeDecision).forEach((line) => emit(line));
  return EXIT.ok;
};

export const runLog = (args: readonly string[]): ExitCode => {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    note(LOG_USAGE);
    return EXIT.ok;
  }
  if (args.length === 1 && args[0] === 'path') {
    emit(decisionsLog());
    return EXIT.ok;
  }
  const options = parseLogArgs(args);
  if (options === null) {
    fail(`unknown log arguments: ${args.join(' ')}`, LOG_USAGE);
    return EXIT.error;
  }
  return show(options);
};
