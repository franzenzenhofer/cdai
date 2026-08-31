import { loadConfig } from '../config.js';
import { contractTilde } from '../paths.js';
import { EXIT, fail, note, type ExitCode } from '../protocol.js';
import { isStale, loadIndex, matchesConfig, refreshIndex } from '../store/indexer.js';

const MILLIS_PER_MINUTE = 60_000;
export const INDEX_USAGE = 'usage: cdai index [--refresh]';

const validateArgs = (args: readonly string[]): ExitCode | null => {
  if (args.includes('--help') || args.includes('-h')) {
    if (args.length !== 1) {
      fail('unexpected index arguments', INDEX_USAGE);
      return EXIT.error;
    }
    note(INDEX_USAGE);
    return EXIT.ok;
  }
  if (args.some((arg) => arg !== '--refresh') || args.filter((arg) => arg === '--refresh').length > 1) {
    fail('unknown index option', INDEX_USAGE);
    return EXIT.error;
  }
  return null;
};

const refresh = (config: ReturnType<typeof loadConfig>): ExitCode => {
  const started = Date.now();
  const index = refreshIndex(config);
  note(`cdai: indexed ${index.entries.length} directories in ${Date.now() - started}ms`);
  if (index.truncated === null) return EXIT.ok;
  fail(`index is partial (${index.truncated} limit)`, 'narrow roots, reduce depth, or split large roots');
  return EXIT.error;
};

export const runIndex = (args: readonly string[]): ExitCode => {
  const handled = validateArgs(args);
  if (handled !== null) return handled;
  const config = loadConfig();
  if (config.roots.length === 0) {
    fail('no roots configured', 'run `cdai setup` once to pick the directories to learn');
    return EXIT.error;
  }
  if (args.includes('--refresh')) return refresh(config);
  const index = loadIndex();
  const ageMinutes = Math.round((Date.now() - index.generatedAt) / MILLIS_PER_MINUTE);
  const stale = isStale(index, Date.now()) || !matchesConfig(index, config);
  const partial = index.truncated === null ? '' : ` (partial: ${index.truncated} limit)`;
  note(`cdai: ${index.entries.length} directories, ${ageMinutes}min old${stale ? ' (stale)' : ''}${partial}`);
  for (const root of config.roots) {
    const count = index.entries.filter((entry) => entry.root === root.path).length;
    note(`      ${contractTilde(root.path)} depth ${root.depth}: ${count}`);
  }
  return EXIT.ok;
};
