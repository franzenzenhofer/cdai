import { existsSync } from 'node:fs';
import { backendLabel, resolveAiBackend } from '../ai/backend.js';
import { configExists, loadConfig, type AiConfig, type Config } from '../config.js';
import { resolveExecutable } from '../executable.js';
import { aliasesFile, configDir, configFile, contractTilde, dataDir, dbFile, hasPrivateMode, indexFile, visitsLog } from '../paths.js';
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

const doctorArgs = (args: readonly string[]): ExitCode | null => {
  if (args.length === 0) return null;
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    note('usage: cdai doctor');
    return EXIT.ok;
  }
  note('cdai: usage: cdai doctor');
  return EXIT.error;
};

const stateIsPrivate = (): boolean =>
  hasPrivateMode(configDir(), true) &&
  hasPrivateMode(dataDir(), true) &&
  [configFile(), indexFile(), dbFile(), aliasesFile(), visitsLog()]
    .filter(existsSync)
    .every((path) => hasPrivateMode(path, false));

export const runDoctor = (args: readonly string[] = []): ExitCode => {
  const handled = doctorArgs(args);
  if (handled !== null) return handled;
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
  const compatible = matchesConfig(index, config);
  const stale = isStale(index, Date.now()) || !compatible;
  const partial = index.truncated === null ? '' : ` (partial: ${index.truncated} limit)`;
  note(`index  ${mark(existsSync(indexFile()) && compatible)} ${index.entries.length} dirs, ${ageMinutes}min old${stale ? ' (stale)' : ''}${partial}`);
  if (!compatible) note('       run `cdai index --refresh` to rebuild the cache');
  note(`db     ${mark(existsSync(dbFile()))} ${loadDb().records.length} remembered paths`);
  note(`alias  ${mark(existsSync(aliasesFile()))} ${loadAliases().aliases.length} confirmed intents`);
  note(`visits ${mark(existsSync(visitsLog()))} ${visitsLog()}`);
  note(`fzf    ${mark(resolveExecutable('fzf') !== null)}`);
  note(`tty    ${mark(hasTty())}`);
  note(`privacy ${mark(stateIsPrivate())} private state permissions`);
  return EXIT.ok;
};
