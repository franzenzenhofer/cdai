import { runDoctor } from './commands/doctor.js';
import { runImportZoxide } from './commands/import-zoxide.js';
import { runIndex } from './commands/index-cmd.js';
import { runQuery } from './commands/query.js';
import { runSetup } from './commands/setup.js';
import { EXIT, fail, note, type ExitCode } from './protocol.js';
import { bashInit } from './shell/bash.js';
import { fishInit } from './shell/fish.js';
import { zshInit } from './shell/zsh.js';

export const VERSION = '0.1.0';

const USAGE = [
  'cdai - cd with intent',
  '',
  'usage:',
  '  cdai <words>              jump to the directory you mean (via the shell function)',
  '  cdai query -- <words>     resolve only, prints the path on stdout',
  '  cdai init <zsh|bash|fish> print the shell integration, meant for eval',
  '  cdai setup [--yes]        detect project roots and write the config',
  '  cdai index [--refresh]    show or rebuild the directory index',
  '  cdai import zoxide        seed frecency from an existing zoxide database',
  '  cdai doctor               show what cdai sees on this machine',
  '  cdai --version',
].join('\n');

const INIT_TEMPLATES: Record<string, () => string> = {
  zsh: zshInit,
  bash: bashInit,
  fish: fishInit,
};

const runInit = (shell: string | undefined): ExitCode => {
  const template = shell === undefined ? undefined : INIT_TEMPLATES[shell];
  if (template === undefined) {
    fail('unknown shell', 'usage: cdai init <zsh|bash|fish>');
    return EXIT.error;
  }
  process.stdout.write(template());
  return EXIT.ok;
};

const runImport = (target: string | undefined): ExitCode => {
  if (target !== 'zoxide') {
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

const dispatch = async (args: readonly string[]): Promise<ExitCode> => {
  const command = args[0];
  if (command === undefined || command === '--help' || command === '-h') {
    note(USAGE);
    return command === undefined ? EXIT.error : EXIT.noCd;
  }
  if (command === '--version' || command === '-v') {
    note(VERSION);
    return EXIT.noCd;
  }
  if (command === 'init') return runInit(args[1]);
  if (command === 'setup') return runSetup(args.slice(1));
  if (command === 'index') return runIndex(args.slice(1));
  if (command === 'import') return runImport(args[1]);
  if (command === 'doctor') return runDoctor();
  if (command === 'query') return runQuery(queryArgs(args));
  return runQuery(args);
};

export const main = async (argv: readonly string[]): Promise<ExitCode> => {
  try {
    return await dispatch(argv);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return EXIT.error;
  }
};

process.exitCode = await main(process.argv.slice(2));
