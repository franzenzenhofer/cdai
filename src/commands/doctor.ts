import { existsSync } from 'node:fs';
import { backendLabel, resolveAiBackend } from '../ai/backend.js';
import { configExists, loadConfig, type AiConfig, type Config } from '../config.js';
import { resolveExecutable } from '../executable.js';
import { aliasesFile, configFile, contractTilde, dataDir, dbFile, indexFile, visitsLog } from '../paths.js';
import { hasTty } from '../picker.js';
import { EXIT, note, type ExitCode } from '../protocol.js';
import { loadDb } from '../store/db.js';
import { loadAliases } from '../store/aliases.js';
import { isStale, loadIndex, matchesConfig } from '../store/indexer.js';

const MILLIS_PER_MINUTE = 60_000;
const mark = (ok: boolean): string => (ok ? 'ok  ' : 'miss');

const reportAi = (ai: AiConfig): void => {
  if (!ai.enabled) {
    note('ai     disabled');
    return;
  }
  const backend = resolveAiBackend(ai);
  note(`ai     enabled via ${backend === null ? ai.command : backendLabel(backend)}`);
  note(`  ${mark(backend !== null)} ${backend?.command ?? 'supported backend'} available`);
};

const reportRoots = (config: Config): void => {
  note(`roots  ${config.roots.length}`);
  for (const root of config.roots) {
    note(`  ${mark(existsSync(root.path))} ${contractTilde(root.path)} (depth ${root.depth})`);
  }
  reportAi(config.ai);
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
  const config = loadConfig();
  reportRoots(config);
  const index = loadIndex();
  const ageMinutes = Math.round((Date.now() - index.generatedAt) / MILLIS_PER_MINUTE);
  const stale = isStale(index, Date.now()) || !matchesConfig(index, config);
  note(`index  ${mark(existsSync(indexFile()))} ${index.entries.length} dirs, ${ageMinutes}min old${stale ? ' (stale)' : ''}`);
  note(`db     ${mark(existsSync(dbFile()))} ${loadDb().records.length} remembered paths`);
  note(`alias  ${mark(existsSync(aliasesFile()))} ${loadAliases().aliases.length} confirmed intents`);
  note(`visits ${mark(existsSync(visitsLog()))} ${visitsLog()}`);
  note(`fzf    ${mark(resolveExecutable('fzf') !== null)}`);
  note(`tty    ${mark(hasTty())}`);
  return EXIT.ok;
};
