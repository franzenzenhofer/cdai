import { configExists, loadConfig, serializeConfig } from '../config.js';
import { configFile, contractTilde } from '@franzenzenhofer/intent-core/paths';
import { EXIT, fail, note, type ExitCode } from '../protocol.js';
import { emit } from '@franzenzenhofer/intent-core/protocol';

export const CONFIG_USAGE = [
  'usage:',
  '  cdai config               print the effective config as JSON, its file on stderr',
  '  cdai config path          print only the config file path',
].join('\n');

/** Every way to change what `cdai config` shows, so nobody has to guess at the file. */
const CHANGE_HINTS = [
  'change it:',
  '  cdai setup --root <path> [--depth <1-64>] [--weight <n>] --yes   add or update a root',
  '  cdai setup --remove-root <path>                                remove a root',
  '  cdai setup --ai | --no-ai                                      AI fallback on or off',
  '  cdai alias add [<path>] -- <words>                             teach an alias',
  '  or edit the file: "aliases": { "<words>": "<path>" } win over everything else',
];

const show = (): ExitCode => {
  const config = loadConfig();
  const state = configExists() ? 'valid' : 'not written yet, showing defaults';
  note(`cdai: config ${contractTilde(configFile())} (${state})`);
  process.stdout.write(serializeConfig(config));
  CHANGE_HINTS.forEach((line) => note(line));
  return EXIT.ok;
};

export const runConfig = (args: readonly string[]): ExitCode => {
  if (args.length === 0) return show();
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    note(CONFIG_USAGE);
    return EXIT.ok;
  }
  if (args.length === 1 && args[0] === 'path') {
    emit(configFile());
    return EXIT.ok;
  }
  fail(`unknown config command: ${args.join(' ')}`, CONFIG_USAGE);
  return EXIT.error;
};
