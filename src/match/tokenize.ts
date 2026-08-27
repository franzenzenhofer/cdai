import {
  IN_OPERATOR,
  LATEST_WORDS,
  OLDEST_WORDS,
  STOPWORDS,
  YEAR_MAX,
  YEAR_MIN,
} from './constants.js';

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
}

const YEAR_PATTERN = /^\d{4}$/;

export const isYear = (token: string): boolean => {
  if (!YEAR_PATTERN.test(token)) return false;
  const value = Number.parseInt(token, 10);
  return value >= YEAR_MIN && value <= YEAR_MAX;
};

export const splitWords = (input: string): string[] =>
  input
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');

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
  const tokens = afterOrder.filter((word) => !isYear(word) && !STOPWORDS.has(word));
  return { raw: input, tokens, order, years, rootFilter };
};

export const tokenizeArgs = (args: readonly string[]): ParsedQuery => tokenize(args.join(' '));
