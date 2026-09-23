import { dropStopwords, isYear as coreIsYear, splitWords } from '@franzenzenhofer/intent-core/match/words';
import {
  pathReading as corePathReading, urlReadings as coreUrlReadings,
} from '@franzenzenhofer/intent-core/match/url';
import { IN_OPERATOR, LATEST_WORDS, OLDEST_WORDS, STOPWORDS, YEAR_MAX, YEAR_MIN } from './constants.js';

export { hostLabels, localNames, pathNames, urlNames } from '@franzenzenhofer/intent-core/match/url';
export { splitWords };

const YEARS = { min: YEAR_MIN, max: YEAR_MAX } as const;

export const isYear = (token: string): boolean => coreIsYear(token, YEARS);

export type Order = 'latest' | 'oldest' | 'none';

export interface ParsedQuery {
  readonly raw: string;
  /** Search terms, lowercased, operators and stopwords removed. */
  readonly tokens: readonly string[];
  readonly order: Order;
  /** Year tokens act as required substrings of the candidate path. */
  readonly years: readonly string[];
  /** `in <name>`: only candidates whose root path contains this name qualify. */
  readonly rootFilter: string | null;
  /** Folders a spelled path puts above its own name: required in the path, worth no score. */
  readonly within: readonly string[];
}

/**
 * A typed-out path read as what it names and where that sits: the folders above the name gate
 * the candidates without diluting the match.
 */
export const pathReading = (query: ParsedQuery): ParsedQuery | null => {
  const read = corePathReading(query.tokens);
  if (read === null) return null;
  return { ...query, tokens: [...read.tokens], within: [...query.within, ...read.within] };
};

/**
 * The same query read as the names its words stand for, best reading first, empty when no word
 * carries any. Client folders are routinely named after the site itself, decoration and all -
 * "nordwind.at", "amt.gv.at" - so the word the user typed always gets the first attempt; these
 * readings are only tried when that finds nothing.
 */
export const urlReadings = (query: ParsedQuery): ParsedQuery[] =>
  coreUrlReadings(query.tokens).map((tokens) => ({ ...query, tokens }));

interface OperatorScan {
  readonly rest: string[];
  readonly rootFilter: string | null;
}

/** `in <root>` is consumed before stopword removal, otherwise "in" would vanish first. */
const takeRootFilter = (words: readonly string[]): OperatorScan => {
  const rest: string[] = [];
  let rootFilter: string | null = null;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word === undefined) continue;
    const next = words[i + 1];
    if (word === IN_OPERATOR && next !== undefined && rootFilter === null) {
      rootFilter = next;
      i += 1;
      continue;
    }
    rest.push(word);
  }
  return { rest, rootFilter };
};

const takeOrder = (words: readonly string[]): { rest: string[]; order: Order } => {
  const rest: string[] = [];
  let order: Order = 'none';
  for (const word of words) {
    if (LATEST_WORDS.has(word) && order === 'none') {
      order = 'latest';
      continue;
    }
    if (OLDEST_WORDS.has(word) && order === 'none') {
      order = 'oldest';
      continue;
    }
    rest.push(word);
  }
  return { rest, order };
};

export const tokenize = (input: string): ParsedQuery => {
  const words = splitWords(input);
  const { rest: afterIn, rootFilter } = takeRootFilter(words);
  const { rest: afterOrder, order } = takeOrder(afterIn);
  const years = afterOrder.filter(isYear);
  const searchable = afterOrder.filter((word) => !isYear(word));
  // A directory may literally be named "project" or "folder"; stopwords cannot erase intent.
  const tokens = dropStopwords(searchable, STOPWORDS);
  // An operator or year can also be a literal directory name when it is the entire query.
  if (tokens.length === 0 && words.length > 0) {
    return { raw: input, tokens: words, order: 'none', years: [], rootFilter: null, within: [] };
  }
  return { raw: input, tokens, order, years, rootFilter, within: [] };
};

export const tokenizeArgs = (args: readonly string[]): ParsedQuery => tokenize(args.join(' '));
