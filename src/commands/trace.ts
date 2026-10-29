import type { ScoredCandidate } from '../match/score.js';
import { EXIT, note, type ExitCode } from '../protocol.js';
import {
  appendDecision, DECISION_VERSION,
  type DecisionEntry, type DecisionOutcome, type DecisionVia, type LoggedAi, type LoggedQuestion,
} from '../store/decisions.js';

/** Enough of the ranking to see why the answer won, small enough to keep a year of lines. */
export const LOGGED_CANDIDATES = 5;

/**
 * What one query decided, collected as it happens and written once at the end. The query code
 * reports facts here; it never reads them back, so a trace cannot change where cdai goes.
 */
export interface Trace {
  readonly via: (via: DecisionVia, path: string) => void;
  readonly ranked: (ranked: readonly ScoredCandidate[]) => void;
  /** A clear winner carries only its own score: the decision rule never kept the runners up. */
  readonly hit: (path: string, score: number) => void;
  readonly rescanned: () => void;
  readonly asked: (question: LoggedQuestion) => void;
  readonly ai: (ai: LoggedAi) => void;
}

interface TraceState {
  via: DecisionVia;
  path: string | null;
  rescanned: boolean;
  candidates: DecisionEntry['candidates'];
  questions: LoggedQuestion[];
  ai: LoggedAi | null;
}

const OUTCOME: Readonly<Record<ExitCode, DecisionOutcome>> = {
  [EXIT.ok]: 'jump',
  [EXIT.error]: 'miss',
  [EXIT.noCd]: 'abort',
  [EXIT.native]: 'native',
};

export interface TraceRun {
  readonly trace: Trace;
  /** Writes the line. A log that cannot be written is said once and never changes the exit code. */
  readonly finish: (code: ExitCode, error: string | null) => void;
}

const recorder = (state: TraceState): Trace => ({
  via: (via, path) => { state.via = via; state.path = path; },
  ranked: (ranked) => {
    state.candidates = ranked.slice(0, LOGGED_CANDIDATES)
      .map((r) => ({ path: r.candidate.path, score: Math.round(r.score) }));
  },
  hit: (path, score) => {
    state.via = 'hit'; state.path = path; state.candidates = [{ path, score: Math.round(score) }];
  },
  rescanned: () => { state.rescanned = true; },
  asked: (question) => { state.questions.push(question); },
  ai: (ai) => { state.ai = ai; },
});

export const startTrace = (words: readonly string[], version: string, enabled: () => boolean): TraceRun => {
  const startedAt = Date.now();
  const cwd = process.cwd();
  const state: TraceState = { via: 'none', path: null, rescanned: false, candidates: [], questions: [], ai: null };
  const finish = (code: ExitCode, error: string | null): void => {
    const entry: DecisionEntry = {
      v: DECISION_VERSION, at: startedAt, version, words: [...words], cwd,
      ...state, path: code === EXIT.ok ? state.path : null,
      outcome: error === null ? OUTCOME[code] : 'error', error, ms: Date.now() - startedAt,
    };
    try {
      if (enabled()) appendDecision(entry);
    } catch (failure) {
      note(`cdai: decision log not written (${failure instanceof Error ? failure.message : String(failure)})`);
    }
  };
  return { trace: recorder(state), finish };
};
