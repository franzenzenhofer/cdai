import { existsSync } from 'node:fs';
import { configExists, loadConfig } from '../config.js';
import { configFile, contractTilde, dataDir, dbFile, indexFile, visitsLog } from '../paths.js';
import { findOnPath, hasTty } from '../picker.js';
import { EXIT, note, type ExitCode } from '../protocol.js';
import { loadDb } from '../store/db.js';
import { isStale, loadIndex } from '../store/indexer.js';

const MILLIS_PER_MINUTE = 60_000;
const mark = (ok: boolean): string => (ok ? 'ok  ' : 'miss');

const reportRoots = (): void => {
  const config = loadConfig();
  note(`roots  ${config.roots.length}`);
  for (const root of config.roots) {
    note(`  ${mark(existsSync(root.path))} ${contractTilde(root.path)} (depth ${root.depth})`);
  }
  note(`ai     ${config.ai.enabled ? 'enabled' : 'disabled'} via ${config.ai.command} ${config.ai.model}`);
  note(`  ${mark(findOnPath(config.ai.command) !== null)} ${config.ai.command} on PATH`);
};

export const runDoctor = (): ExitCode => {
  note('cdai doctor');
  note(`node   ${process.version}`);
  note(`config ${mark(configExists())} ${configFile()}`);
  note(`data   ${dataDir()}`);
  if (!configExists()) {
    note('run `cdai setup` to get started');
    return EXIT.error;
  }
  reportRoots();
  const index = loadIndex();
  const ageMinutes = Math.round((Date.now() - index.generatedAt) / MILLIS_PER_MINUTE);
  note(`index  ${mark(existsSync(indexFile()))} ${index.entries.length} dirs, ${ageMinutes}min old${isStale(index, Date.now()) ? ' (stale)' : ''}`);
  note(`db     ${mark(existsSync(dbFile()))} ${loadDb().records.length} remembered paths`);
  note(`visits ${mark(existsSync(visitsLog()))} ${visitsLog()}`);
  note(`fzf    ${mark(findOnPath('fzf') !== null)}`);
  note(`tty    ${mark(hasTty())}`);
  return EXIT.noCd;
};
