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
  /** The word read as `order`, kept because it may just as well be part of a name. */
  readonly orderWord: string | null;
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

interface OrderScan {
  readonly rest: string[];
  readonly order: Order;
  readonly orderWord: string | null;
}

const orderOf = (word: string): Order => {
  if (LATEST_WORDS.has(word)) return 'latest';
  return OLDEST_WORDS.has(word) ? 'oldest' : 'none';
};

const takeOrder = (words: readonly string[]): OrderScan => {
  const rest: string[] = [];
  let order: Order = 'none';
  let orderWord: string | null = null;
  for (const word of words) {
    const wordOrder: Order = order === 'none' ? orderOf(word) : 'none';
    if (wordOrder === 'none') {
      rest.push(word);
      continue;
    }
    order = wordOrder;
    orderWord = word;
  }
  return { rest, order, orderWord };
};

/**
 * The same query with its order word read as part of a name, not as an operator: "mobile first
 * workshop" names a folder before it asks for the oldest of anything. The word must appear in the
 * path literally, so "latest petalworks" finds nothing this way and keeps its operator meaning.
 */
export const termReading = (query: ParsedQuery): ParsedQuery | null => {
  if (query.orderWord === null) return null;
  return {
    ...query,
    tokens: [...query.tokens, query.orderWord],
    order: 'none',
    orderWord: null,
    within: [...query.within, query.orderWord],
  };
};

/**
 * What two typings of one intent share: every word but the filler. Order words and years stay, so
 * a remembered "mobile first" never answers "latest mobile" or plain "mobile".
 */
export const intentKey = (input: string): string => dropStopwords(splitWords(input), STOPWORDS).join(' ');

export const tokenize = (input: string): ParsedQuery => {
  const words = splitWords(input);
  const { rest: afterIn, rootFilter } = takeRootFilter(words);
  const { rest: afterOrder, order, orderWord } = takeOrder(afterIn);
  const years = afterOrder.filter(isYear);
  const searchable = afterOrder.filter((word) => !isYear(word));
  // A directory may literally be named "project" or "folder"; stopwords cannot erase intent.
  const tokens = dropStopwords(searchable, STOPWORDS);
  // An operator or year can also be a literal directory name when it is the entire query.
  if (tokens.length === 0 && words.length > 0) {
    return { raw: input, tokens: words, order: 'none', orderWord: null, years: [], rootFilter: null, within: [] };
  }
  return { raw: input, tokens, order, orderWord, years, rootFilter, within: [] };
};

export const tokenizeArgs = (args: readonly string[]): ParsedQuery => tokenize(args.join(' '));
