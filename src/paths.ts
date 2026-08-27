import { homedir } from 'node:os';
import { join, isAbsolute, resolve, sep } from 'node:path';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';

const APP_NAME = 'cdai';
const TMP_SUFFIX = '.tmp';
const FILE_MODE = 0o644;

export const configDir = (): string => {
  const override = process.env['CDAI_CONFIG_DIR'];
  if (override !== undefined && override !== '') return resolve(expandTilde(override));
  const xdg = process.env['XDG_CONFIG_HOME'];
  if (xdg !== undefined && xdg !== '') return join(xdg, APP_NAME);
  return join(homedir(), '.config', APP_NAME);
};

export const dataDir = (): string => {
  const override = process.env['CDAI_DATA_DIR'];
  if (override !== undefined && override !== '') return resolve(expandTilde(override));
  const xdg = process.env['XDG_DATA_HOME'];
  if (xdg !== undefined && xdg !== '') return join(xdg, APP_NAME);
  return join(homedir(), '.local', 'share', APP_NAME);
};

export const configFile = (): string => join(configDir(), 'config.json');
export const dbFile = (): string => join(dataDir(), 'db.json');
export const indexFile = (): string => join(dataDir(), 'index.json');
export const visitsLog = (): string => join(dataDir(), 'visits.log');

export const expandTilde = (input: string): string => {
  if (input === '~') return homedir();
  if (input.startsWith(`~${sep}`)) return join(homedir(), input.slice(2));
  return input;
};

export const contractTilde = (input: string): string => {
  const home = homedir();
  if (input === home) return '~';
  if (input.startsWith(home + sep)) return `~${sep}${input.slice(home.length + 1)}`;
  return input;
};

export const absolutize = (input: string): string => {
  const expanded = expandTilde(input);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(process.cwd(), expanded);
};

export const ensureDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
};

/** Atomic write: same-directory temp file plus rename, so readers never see a partial file. */
export const writeAtomic = (file: string, contents: string): void => {
  ensureDir(dirname(file));
  const tmp = `${file}.${process.pid}${TMP_SUFFIX}`;
  writeFileSync(tmp, contents, { encoding: 'utf8', mode: FILE_MODE });
  renameSync(tmp, file);
};

const dirname = (file: string): string => {
  const idx = file.lastIndexOf(sep);
  return idx <= 0 ? sep : file.slice(0, idx);
};

export const isUnder = (child: string, parent: string): boolean => {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
};
