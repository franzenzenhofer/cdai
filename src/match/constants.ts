/** Every tunable number the matcher uses lives here, so thresholds are tuned in one place. */

export const SCORE = {
  exact: 1000,
  prefix: 800,
  wordBoundary: 600,
  substring: 400,
  fuzzyMax: 380,
  /** Token found nowhere in the name but present in the path above it. */
  pathOnly: 200,
  none: 0,
} as const;

/** Fuzzy subsequence scoring. */
export const FUZZY = {
  /** Base share of fuzzyMax awarded for matching all characters at all. */
  baseShare: 0.45,
  /** Share awarded proportionally to how densely the characters sit together. */
  densityShare: 0.35,
  /** Share awarded for how much of the candidate name the query covers. */
  coverageShare: 0.2,
} as const;

/** Bonuses added on top of the raw name match. */
export const BONUS = {
  /** Weight of log2(1 + frecency). */
  frecency: 100,
  /** Candidate lives under the current working directory. */
  underCwd: 25,
  /**
   * Deterministic tie break: awarded in proportion to how much of the candidate name the
   * query covers, so "bella" prefers "petalworks" over "petalworks-2026" at equal match class.
   */
  brevity: 40,
} as const;

/** Decision thresholds for resolve(). */
export const THRESHOLD = {
  /** A single candidate at or above this score wins outright when the gap is big enough. */
  hit: 550,
  /** Minimum gap between best and runner up for an outright win. */
  gap: 200,
  /** Candidates at or above this score are worth showing in the picker. */
  candidate: 400,
  /** Fewer than this many picker-worthy candidates falls through to the AI tier. */
  minPickerCandidates: 2,
} as const;

export const COMPLETION = {
  /** Short fuzzy fragments create noisy, destructive shell replacements. */
  minSmartLength: 3,
  maxTypoLength: 64,
} as const;

export const LIMIT = {
  /** Candidates offered to the picker. */
  picker: 10,
  /** Fuzzy candidates handed to the AI tier. */
  aiFuzzy: 30,
  /** Most frecent paths handed to the AI tier. */
  aiFrecent: 20,
  /** Guesses printed when nothing matched. */
  suggestions: 3,
} as const;

export const STOPWORDS = new Set([
  'folder',
  'dir',
  'directory',
  'the',
  'project',
  'go',
  'to',
  'my',
  'in',
]);

export const LATEST_WORDS = new Set(['latest', 'newest', 'last', 'recent']);
export const OLDEST_WORDS = new Set(['oldest', 'first']);
export const IN_OPERATOR = 'in';

export const YEAR_MIN = 1990;
export const YEAR_MAX = 2999;
