import { loadConfig } from '../config.js';
import { contractTilde } from '../paths.js';
import { EXIT, fail, note, type ExitCode } from '../protocol.js';
import { isStale, loadIndex, matchesConfig, refreshIndex } from '../store/indexer.js';

const MILLIS_PER_MINUTE = 60_000;

export const runIndex = (args: readonly string[]): ExitCode => {
  const config = loadConfig();
  if (config.roots.length === 0) {
    fail('no roots configured', 'run `cdai setup` once to pick the directories to learn');
    return EXIT.error;
  }
  if (args.includes('--refresh')) {
    const started = Date.now();
    const index = refreshIndex(config);
    note(`cdai: indexed ${index.entries.length} directories in ${Date.now() - started}ms`);
    return EXIT.ok;
  }
  const index = loadIndex();
  const ageMinutes = Math.round((Date.now() - index.generatedAt) / MILLIS_PER_MINUTE);
  const stale = isStale(index, Date.now()) || !matchesConfig(index, config);
  note(`cdai: ${index.entries.length} directories, ${ageMinutes}min old${stale ? ' (stale)' : ''}`);
  for (const root of config.roots) {
    const count = index.entries.filter((entry) => entry.root === root.path).length;
    note(`      ${contractTilde(root.path)} depth ${root.depth}: ${count}`);
  }
  return EXIT.ok;
};
