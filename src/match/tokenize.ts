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
/** "www.lumenlab.com", "lumenlab.com/blog" - a host, optionally with a path tail. */
const HOST_PATTERN = /^(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:\/.*)?$/;
/**
 * Only real public suffixes turn a dotted word into a host, so "node.js" and "vite.config"
 * stay literal directory names.
 */
const TLDS = new Set([
  'com', 'net', 'org', 'info', 'biz', 'io', 'ai', 'dev', 'app', 'co', 'me', 'tv', 'xyz',
  'cloud', 'site', 'online', 'shop', 'blog', 'at', 'de', 'ch', 'uk', 'eu', 'it', 'fr', 'es',
  'nl', 'pl', 'cz', 'hu', 'si', 'sk', 'us', 'ca', 'au', 'nz', 'jp', 'cn', 'in', 'br',
]);
/** Labels that decorate a host without naming it, in either the sub- or the second level. */
const HOST_NOISE = new Set([
  'www', 'm', 'web', 'shop', 'blog', 'app', 'api', 'dev', 'staging', 'test', 'mail',
  'co', 'com', 'net', 'org', 'gov', 'edu', 'ac',
]);

export const isYear = (token: string): boolean => {
  if (!YEAR_PATTERN.test(token)) return false;
  const value = Number.parseInt(token, 10);
  return value >= YEAR_MIN && value <= YEAR_MAX;
};

/**
 * A host is a name plus decoration: scheme, subdomain, TLD, path. A directory may be named
 * after the name ("lumenlab-website") instead of the host, so "www.lumenlab.com/blog" also
 * searches for "lumenlab". Reduced only when a recognisable host survives; "vite.config" stays
 * intact. This is an alternative reading, never a replacement - see `hostReduced`.
 */
export const hostLabel = (word: string): string => {
  const bare = word.replace(/^[a-z]+:\/\//u, '').replace(/[.,;:!?]+$/u, '');
  if (!HOST_PATTERN.test(bare)) return word;
  const labels = bare.split('/')[0]?.split('.') ?? [];
  if (!TLDS.has(labels.at(-1) ?? '')) return word;
  const named = labels.slice(0, -1).filter((label) => !HOST_NOISE.has(label));
  return named.at(-1) ?? word;
};

export const splitWords = (input: string): string[] =>
  input
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');

/**
 * The same query read as host names instead of literal words, or null when no word is a host.
 * Franz's client folders are literally called "nordwind.at" and "amt.gv.at", so the word the user
 * typed always gets the first attempt; this reading is only tried when that finds nothing.
 */
export const hostReduced = (query: ParsedQuery): ParsedQuery | null => {
  const tokens = query.tokens.map(hostLabel);
  if (tokens.every((token, index) => token === query.tokens[index])) return null;
  return { ...query, tokens };
};

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
  const meaningful = searchable.filter((word) => !STOPWORDS.has(word));
  // A directory may literally be named "project" or "folder"; stopwords cannot erase intent.
  const tokens = meaningful.length > 0 ? meaningful : searchable;
  // An operator or year can also be a literal directory name when it is the entire query.
  if (tokens.length === 0 && words.length > 0) {
    return { raw: input, tokens: words, order: 'none', years: [], rootFilter: null };
  }
  return { raw: input, tokens, order, years, rootFilter };
};

export const tokenizeArgs = (args: readonly string[]): ParsedQuery => tokenize(args.join(' '));
