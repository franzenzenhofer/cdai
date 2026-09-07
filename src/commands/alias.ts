import { loadConfig } from '../config.js';
import {
  absolutize,
  contractTilde,
  isDirectory,
  isProtocolSafePath,
  isUnderRoot,
} from '../paths.js';
import { EXIT, fail, note, type ExitCode } from '../protocol.js';
import { forgetAlias, loadAliases, normalizeIntent, rememberAlias } from '../store/aliases.js';

const MILLIS_PER_SECOND = 1000;

export const ALIAS_USAGE = [
  'usage:',
  '  cdai alias list',
  '  cdai alias add [<path>] -- <words>',
  '  cdai alias forget -- <words>',
].join('\n');

/** Words after `--`; anything before it is the directory, defaulting to the current one. */
interface AliasInput {
  readonly path: string;
  readonly query: string;
}

const looksLikePath = (word: string): boolean => word.includes('/') || word.startsWith('~');

const readAddArgs = (args: readonly string[]): AliasInput | string => {
  const separator = args.indexOf('--');
  const before = separator === -1 ? [] : args.slice(0, separator);
  const words = separator === -1 ? args : args.slice(separator + 1);
  if (before.length > 1) return 'one directory at a time';
  if (separator === -1 && words.some(looksLikePath)) return 'put the directory before --';
  const query = normalizeIntent(words.join(' '));
  if (query === '') return 'missing words to remember';
  return { path: absolutize(before[0] ?? process.cwd()), query };
};

/** An alias outside the configured roots is dropped the moment it is used, so refuse it here. */
const rejection = (path: string): string | null => {
  if (!isDirectory(path)) return `no such directory: ${contractTilde(path)}`;
  if (!isProtocolSafePath(path)) return 'directory contains a line break unsupported by shell transport';
  if (loadConfig().roots.some((root) => isUnderRoot(path, root.path))) return null;
  return `${contractTilde(path)} is outside every configured root; add it with \`cdai setup\``;
};

const add = (args: readonly string[]): ExitCode => {
  if (args[0] === '--help' || args[0] === '-h') {
    note(ALIAS_USAGE);
    return EXIT.ok;
  }
  const input = readAddArgs(args);
  if (typeof input === 'string') {
    fail(input, ALIAS_USAGE);
    return EXIT.error;
  }
  const rejected = rejection(input.path);
  if (rejected !== null) {
    fail(rejected);
    return EXIT.error;
  }
  rememberAlias(input.query, input.path, Math.floor(Date.now() / MILLIS_PER_SECOND));
  note(`cdai: "${input.query}" -> ${contractTilde(input.path)}`);
  return EXIT.ok;
};

const forget = (args: readonly string[]): ExitCode => {
  if (args[0] === '--help' || args[0] === '-h') {
    note(ALIAS_USAGE);
    return EXIT.ok;
  }
  if (args[0]?.startsWith('-') === true && args[0] !== '--') {
    fail(`unknown alias option: ${args[0]}`, ALIAS_USAGE);
    return EXIT.error;
  }
  const words = args[0] === '--' ? args.slice(1) : args;
  const query = words.join(' ').trim();
  if (query === '') {
    fail('missing intent to forget', ALIAS_USAGE);
    return EXIT.error;
  }
  if (!forgetAlias(query)) {
    fail(`no confirmed alias for "${query}"`);
    return EXIT.error;
  }
  note(`cdai: forgot "${query}"`);
  return EXIT.ok;
};

export const runAlias = (args: readonly string[]): ExitCode => {
  const command = args[0];
  if (command === '--help' || command === '-h') {
    note(ALIAS_USAGE);
    return EXIT.ok;
  }
  if (command === 'list' && args.length === 1) {
    const aliases = loadAliases().aliases;
    if (aliases.length === 0) note('cdai: no confirmed intent aliases');
    aliases.forEach((alias) => note(`${alias.query} -> ${contractTilde(alias.path)}`));
    return EXIT.ok;
  }
  if (command === 'add') return add(args.slice(1));
  if (command === 'forget') return forget(args.slice(1));
  fail('unknown alias command', ALIAS_USAGE);
  return EXIT.error;
};
