import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirOf, ensureDir, writeAtomic } from '@franzenzenhofer/intent-core/paths';
import { withStateLock } from '@franzenzenhofer/intent-core/store/lock';
import { decisionsLog } from '../state.js';

export const DECISION_VERSION = 1;
/** Past this size the oldest half goes: a log big enough to learn from, never a disk hog. */
export const MAX_LOG_BYTES = 2 * 1024 * 1024;
const PRIVATE_FILE_MODE = 0o600;

/** How the answer was reached. `none` means nothing answered. */
export type DecisionVia = 'path' | 'config-alias' | 'taught-alias' | 'hit' | 'picker' | 'ai' | 'none';
/** What happened to the shell: it moved, stayed by choice, stayed for lack of an answer, or cd spoke. */
export type DecisionOutcome = 'jump' | 'abort' | 'miss' | 'native' | 'error';

export interface LoggedCandidate {
  readonly path: string;
  readonly score: number;
}

/** Every question cdai put to the person, and what they answered. */
export interface LoggedQuestion {
  readonly kind: 'picker' | 'confirm';
  readonly options: readonly string[];
  /** The chosen path, or null for an aborted picker or a declined confirmation. */
  readonly answer: string | null;
}

export interface LoggedAi {
  readonly backend: string;
  readonly answered: boolean;
  /** The model's reason when it chose, or why it produced nothing usable. */
  readonly note: string;
  readonly offered: number;
  readonly ms: number;
}

export interface DecisionEntry {
  readonly v: number;
  /** Epoch milliseconds. */
  readonly at: number;
  readonly version: string;
  readonly words: readonly string[];
  readonly cwd: string;
  readonly via: DecisionVia;
  readonly outcome: DecisionOutcome;
  readonly path: string | null;
  readonly rescanned: boolean;
  readonly candidates: readonly LoggedCandidate[];
  readonly questions: readonly LoggedQuestion[];
  readonly ai: LoggedAi | null;
  readonly error: string | null;
  readonly ms: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEntry = (value: unknown): value is DecisionEntry =>
  isRecord(value) && value['v'] === DECISION_VERSION && typeof value['at'] === 'number'
  && Array.isArray(value['words']) && typeof value['via'] === 'string'
  && typeof value['outcome'] === 'string' && Array.isArray(value['candidates'])
  && Array.isArray(value['questions']);

const parseLine = (line: string): DecisionEntry | null => {
  try {
    const value: unknown = JSON.parse(line);
    return isEntry(value) ? value : null;
  } catch {
    return null;
  }
};

/** A torn last line from a crash, or a line from a future version, is skipped, never fatal. */
export const parseDecisions = (contents: string): DecisionEntry[] =>
  contents.split('\n').flatMap((line) => {
    const entry = line === '' ? null : parseLine(line);
    return entry === null ? [] : [entry];
  });

export const loadDecisions = (): DecisionEntry[] => {
  const file = decisionsLog();
  if (!existsSync(file)) return [];
  return parseDecisions(readFileSync(file, 'utf8'));
};

const keepNewerHalf = (file: string): void => {
  const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line !== '');
  writeAtomic(file, `${lines.slice(Math.floor(lines.length / 2)).join('\n')}\n`);
};

/**
 * One line per decision, appended: a single small write under O_APPEND never interleaves with
 * another shell's, so the hot path takes no lock. Only the rare trim does. The mode applies on
 * creation; an older file is tightened by secureExistingState like every other state file.
 */
export const appendDecision = (entry: DecisionEntry): void => {
  const file = decisionsLog();
  ensureDir(dirOf(file));
  appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: PRIVATE_FILE_MODE });
  if (statSync(file).size <= MAX_LOG_BYTES) return;
  withStateLock(file, () => {
    if (statSync(file).size > MAX_LOG_BYTES) keepNewerHalf(file);
  });
};
