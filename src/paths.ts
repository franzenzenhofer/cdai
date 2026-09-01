import { homedir } from 'node:os';
import { join, isAbsolute, resolve, sep } from 'node:path';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';

const APP_NAME = 'cdai';
const TMP_SUFFIX = '.tmp';
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_MASK = 0o077;

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
export const aliasesFile = (): string => join(dataDir(), 'aliases.json');
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
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  tightenMode(dir, PRIVATE_DIR_MODE);
};

/** Atomic write: same-directory temp file plus rename, so readers never see a partial file. */
export const writeAtomic = (file: string, contents: string): void => {
  ensureDir(dirname(file));
  const tmp = `${file}.${process.pid}${TMP_SUFFIX}`;
  const mode = privateMode(file, PRIVATE_FILE_MODE);
  writeFileSync(tmp, contents, { encoding: 'utf8', mode });
  chmodSync(tmp, mode);
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

/** The only question that matters about a matched path: can the shell cd into it? */
export const isDirectory = (path: string): boolean => {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Newline-delimited shell output cannot represent paths containing a line break. */
export const isProtocolSafePath = (path: string): boolean => !/[\r\n]/u.test(path);

const privateMode = (path: string, fallback: number): number => {
  try {
    const current = statSync(path).mode & 0o777;
    const privateCurrent = current & ~PRIVATE_MASK;
    return privateCurrent === 0 ? fallback : privateCurrent;
  } catch {
    return fallback;
  }
};

const tightenMode = (path: string, fallback: number): void => {
  try {
    if (lstatSync(path).isSymbolicLink()) return;
    chmodSync(path, privateMode(path, fallback));
  } catch {
    // Diagnostics report paths that cannot be secured; normal commands still degrade safely.
  }
};

/** Tightens legacy installs on every invocation without creating any missing state. */
export const secureExistingState = (): void => {
  const dirs = [configDir(), dataDir()];
  let claims: string[] = [];
  try {
    claims = readdirSync(dataDir())
      .filter((name) => name.startsWith('visits.log.ingest.'))
      .map((name) => join(dataDir(), name));
  } catch {
    // A missing data directory is normal before first setup.
  }
  const files = [configFile(), dbFile(), indexFile(), aliasesFile(), visitsLog(), ...claims];
  dirs.filter(existsSync).forEach((path) => tightenMode(path, PRIVATE_DIR_MODE));
  files.filter(existsSync).forEach((path) => tightenMode(path, PRIVATE_FILE_MODE));
};

export const hasPrivateMode = (path: string, directory: boolean): boolean => {
  try {
    const expected = directory ? PRIVATE_DIR_MODE : PRIVATE_FILE_MODE;
    return (statSync(path).mode & PRIVATE_MASK) === 0 && (statSync(path).mode & expected) !== 0;
  } catch {
    return false;
  }
};
