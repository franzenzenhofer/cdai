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
/**
 * Labels that decorate a host without naming it, in either the sub- or the second level. The
 * platforms belong here too: nobody's project is called "github" or "pages", so a link to one
 * is named by its path instead.
 */
const HOST_NOISE = new Set([
  'www', 'm', 'web', 'shop', 'blog', 'app', 'api', 'dev', 'staging', 'test', 'mail',
  'co', 'com', 'net', 'org', 'gov', 'gv', 'edu', 'ac',
  'github', 'gitlab', 'bitbucket', 'codeberg', 'sourceforge', 'npmjs', 'huggingface',
  'pages', 'workers', 'vercel', 'netlify', 'herokuapp', 'replit', 'glitch',
]);
/** Path segments that number or decorate a page without naming the project behind it. */
const PATH_NOISE = new Set([
  'index', 'home', 'en', 'de', 'at', 'us', 'uk', 'p', 'page', 'pages', 'blog', 'post', 'posts',
  'docs', 'doc', 'level', 'tag', 'tags', 'category', 'search', 'www', 'main', 'master',
]);
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//u;
/** A word spelled as a location on this machine rather than as a name. */
const LOCAL_PATH = /^~|\//u;
const PAGE_SUFFIX = /\.(?:html?|php|aspx?|jsp|md)$/u;
const MIN_NAME_LENGTH = 2;
/** A word has at most this many readings, so one pasted link cannot fan the resolver out. */
const MAX_NAME_READINGS = 4;

export const isYear = (token: string): boolean => {
  if (!YEAR_PATTERN.test(token)) return false;
  const value = Number.parseInt(token, 10);
  return value >= YEAR_MIN && value <= YEAR_MAX;
};

const stripScheme = (word: string): string =>
  word.replace(URL_SCHEME, '').replace(/[.,;:!?]+$/u, '');

/**
 * The labels of a host that can name a directory, most specific first. A host is a name plus
 * decoration: scheme, TLD, path, and labels like "www" or "shop" that describe a site rather
 * than name it. What is left can still be two names - "tidewheel.orbit.dev" is the project
 * "tidewheel" hosted under "orbit" - and a folder is routinely called either, so both readings
 * survive, the leftmost one first. Empty when no recognisable host is there at all, so
 * "node.js" and "vite.config" stay literal directory names.
 */
export const hostLabels = (word: string): string[] => {
  const bare = stripScheme(word);
  if (!HOST_PATTERN.test(bare)) return [];
  const labels = bare.split('/')[0]?.split('.') ?? [];
  if (!TLDS.has(labels.at(-1) ?? '')) return [];
  return labels.slice(0, -1).filter((label) => !HOST_NOISE.has(label));
};

/**
 * The names a URL carries in its path, deepest first: a repository, a product or a project is
 * routinely the last segment ("github.com/octocat/tidewheel"), while the segments that only
 * paginate or localise a page name nothing.
 */
export const pathNames = (word: string): string[] => {
  const bare = stripScheme(word);
  if (!URL_SCHEME.test(word) && !HOST_PATTERN.test(bare)) return [];
  return bare
    .split('/')
    .slice(1)
    .map((segment) => (segment.split('?')[0] ?? '').replace(PAGE_SUFFIX, ''))
    .filter((segment) => segment.length >= MIN_NAME_LENGTH
      && !/^\d+$/u.test(segment)
      && !PATH_NOISE.has(segment))
    .reverse();
};

/**
 * The names a spelled-out filesystem path carries, deepest first. A path leading nowhere still
 * describes where the user meant to go: "./dev/petalwroks" says a folder called something like
 * "petalwroks" sits inside "dev", and no tier can see that while the separators are in the way.
 */
export const localNames = (word: string): string[] => {
  if (URL_SCHEME.test(word) || !LOCAL_PATH.test(word)) return [];
  return word
    .split('/')
    .map((segment) => segment.replace(PAGE_SUFFIX, ''))
    .filter((segment) => segment.length >= MIN_NAME_LENGTH
      && segment !== '..'
      && !PATH_NOISE.has(segment))
    .reverse();
};

/**
 * Every name one word can stand for, most specific first: what a link points at, what hosts it,
 * and what a typed-out path calls the place at its end.
 */
export const spelledNames = (word: string): string[] =>
  [...pathNames(word), ...hostLabels(word), ...localNames(word)];

export const splitWords = (input: string): string[] =>
  input
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');

/**
 * The same query read as the names its words stand for, best reading first, empty when no word
 * carries any. Client folders are routinely named after the site itself, decoration and all -
 * "nordwind.at", "amt.gv.at" - so the word the user typed always gets the first attempt; these
 * readings are only tried when that finds nothing.
 */
export const nameReadings = (query: ParsedQuery): ParsedQuery[] => {
  const names = query.tokens.map(spelledNames);
  const depth = Math.min(MAX_NAME_READINGS, Math.max(0, ...names.map((list) => list.length)));
  const readings: ParsedQuery[] = [];
  for (let level = 0; level < depth; level += 1) {
    const tokens = query.tokens.map((token, index) => {
      const list = names[index] ?? [];
      return list[Math.min(level, list.length - 1)] ?? token;
    });
    const known = [query, ...readings];
    if (known.some((seen) => seen.tokens.every((token, index) => token === tokens[index]))) continue;
    readings.push({ ...query, tokens });
  }
  return readings;
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
