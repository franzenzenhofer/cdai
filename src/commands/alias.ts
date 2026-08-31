import { contractTilde } from '../paths.js';
import { EXIT, fail, note, type ExitCode } from '../protocol.js';
import { forgetAlias, loadAliases } from '../store/aliases.js';

export const ALIAS_USAGE = [
  'usage:',
  '  cdai alias list',
  '  cdai alias forget -- <words>',
].join('\n');

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
  if (command === 'forget') return forget(args.slice(1));
  fail('unknown alias command', ALIAS_USAGE);
  return EXIT.error;
};
