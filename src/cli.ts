import { runAlias } from './commands/alias.js';
import { runDoctor } from './commands/doctor.js';
import { runComplete } from './commands/complete.js';
import { runImportZoxide } from './commands/import-zoxide.js';
import { runIndex } from './commands/index-cmd.js';
import { runQuery } from './commands/query.js';
import { runSetup } from './commands/setup.js';
import { EXIT, fail, note, type ExitCode } from './protocol.js';
import { bashInit } from './shell/bash.js';
import { fishInit } from './shell/fish.js';
import { zshInit } from './shell/zsh.js';
import { secureExistingState } from './paths.js';
import packageJson from '../package.json' with { type: 'json' };

export const VERSION = packageJson.version;

const USAGE = [
  'cdai - cd with intent',
  '',
  'usage:',
  '  cdai [cd-options] <words> jump using native cd first, then index/memory/AI intent',
  '  cdai <explicit/path>      native cd only; explicit paths are never guessed',
  '  cdai query -- <words>     resolve only, prints the path on stdout',
  '  cdai init <zsh|bash|fish> print the shell integration, meant for eval',
  '  cdai setup [--yes] [--ai|--no-ai] [--root <path>] [--depth <n>]',
  '             [--remove-root <path>]',
  '                            configure roots and optional AI fallback',
  '  cdai index [--refresh]    show or rebuild the directory index',
  '  cdai import zoxide        seed frecency from an existing zoxide database',
  '  cdai alias <list|forget>  inspect or correct confirmed local intent',
  '  cdai doctor               show what cdai sees on this machine',
  '  cdai --version',
  '',
  'shell behavior:',
  '  Tab ranks filesystem, index, memory, context, and safe fuzzy intent without crawling or AI.',
  '  zsh/Bash cd flags such as -L and -P also compose with indexed intent.',
  '  Confirmed AI intent is remembered locally; disable AI with setup --no-ai.',
].join('\n');

const INIT_TEMPLATES: Record<string, () => string> = {
  zsh: zshInit,
  bash: bashInit,
  fish: fishInit,
};

const runInit = (args: readonly string[]): ExitCode => {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    note('usage: cdai init <zsh|bash|fish>');
    return EXIT.ok;
  }
  const shell = args[0];
  const template = shell === undefined ? undefined : INIT_TEMPLATES[shell];
  if (template === undefined || args.length !== 1) {
    fail('unknown shell', 'usage: cdai init <zsh|bash|fish>');
    return EXIT.error;
  }
  process.stdout.write(template());
  return EXIT.ok;
};

const runImport = (args: readonly string[]): ExitCode => {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    note('usage: cdai import zoxide');
    return EXIT.ok;
  }
  if (args.length !== 1 || args[0] !== 'zoxide') {
    fail('unknown import source', 'usage: cdai import zoxide');
    return EXIT.error;
  }
  return runImportZoxide();
};

/** `query --` guards against a query word being read as a flag. */
const queryArgs = (args: readonly string[]): string[] => {
  const rest = args.slice(1);
  return rest[0] === '--' ? rest.slice(1) : rest;
};

const runQueryCommand = async (args: readonly string[]): Promise<ExitCode> => {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    note('usage: cdai query -- <words>');
    return EXIT.ok;
  }
  return runQuery(args[0] === '--' ? args.slice(1) : args);
};

const dispatch = async (args: readonly string[]): Promise<ExitCode> => {
  const command = args[0];
  if (command === undefined || command === '--help' || command === '-h') {
    note(USAGE);
    return command === undefined ? EXIT.error : EXIT.ok;
  }
  if (command === '--version' || command === '-v') {
    note(VERSION);
    return EXIT.ok;
  }
  if (command === 'init') return runInit(args.slice(1));
  if (command === 'setup') return runSetup(args.slice(1));
  if (command === 'index') return runIndex(args.slice(1));
  if (command === 'import') return runImport(args.slice(1));
  if (command === 'alias') return runAlias(args.slice(1));
  if (command === 'doctor') return runDoctor(args.slice(1));
  if (command === 'complete') return runComplete(queryArgs(args));
  if (command === 'query') return runQueryCommand(args.slice(1));
  return runQuery(args);
};

export const main = async (argv: readonly string[]): Promise<ExitCode> => {
  try {
    secureExistingState();
    return await dispatch(argv);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return EXIT.error;
  }
};

process.exitCode = await main(process.argv.slice(2));
