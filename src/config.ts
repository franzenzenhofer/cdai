import { readFileSync, existsSync } from 'node:fs';
import { absolutize, configFile, writeAtomic } from './paths.js';
import { withStateLock } from './store/lock.js';

export const DEFAULT_DEPTH = 2;
export const MAX_DEPTH = 64;
export const DEFAULT_IGNORE = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.cache',
];
export const DEFAULT_AI = {
  enabled: true,
  command: 'auto',
  args: [] as string[],
  model: '',
  /** Long enough for remote CLI cold starts while still bounding a failed backend. */
  timeoutMs: 45_000,
} as const;

const MAX_TIMER_MS = 2_147_483_647;

export interface RootConfig {
  readonly path: string;
  readonly depth: number;
}

export interface AiConfig {
  readonly enabled: boolean;
  readonly command: string;
  readonly args: readonly string[];
  readonly model: string;
  readonly timeoutMs: number;
}

export interface Config {
  readonly roots: readonly RootConfig[];
  readonly ignore: readonly string[];
  readonly ai: AiConfig;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readRoots = (value: unknown): RootConfig[] => {
  if (!Array.isArray(value)) return [];
  const roots = new Map<string, RootConfig>();
  for (const entry of value) {
    const rawPath = typeof entry === 'string' ? entry : isRecord(entry) ? entry['path'] : undefined;
    if (typeof rawPath !== 'string' || rawPath.trim() === '') continue;
    const rawDepth = isRecord(entry) ? entry['depth'] : undefined;
    const validDepth =
      typeof rawDepth === 'number' && Number.isFinite(rawDepth) && rawDepth > 0
        ? Math.min(MAX_DEPTH, Math.floor(rawDepth))
        : DEFAULT_DEPTH;
    const path = absolutize(rawPath);
    roots.set(path, { path, depth: validDepth });
  }
  return [...roots.values()];
};

const readAi = (value: unknown): AiConfig => {
  if (!isRecord(value)) return { ...DEFAULT_AI };
  const args = value['args'];
  const command = value['command'];
  const timeoutMs = value['timeoutMs'];
  return {
    enabled: typeof value['enabled'] === 'boolean' ? value['enabled'] : DEFAULT_AI.enabled,
    command:
      typeof command === 'string' && command.trim() !== '' ? command : DEFAULT_AI.command,
    args: Array.isArray(args) ? args.filter((a): a is string => typeof a === 'string') : [],
    model: typeof value['model'] === 'string' ? value['model'] : DEFAULT_AI.model,
    timeoutMs:
      typeof timeoutMs === 'number' &&
      Number.isSafeInteger(timeoutMs) &&
      timeoutMs > 0 &&
      timeoutMs <= MAX_TIMER_MS
        ? timeoutMs
        : DEFAULT_AI.timeoutMs,
  };
};

const readIgnore = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [...DEFAULT_IGNORE];

export const emptyConfig = (): Config => ({ roots: [], ignore: [...DEFAULT_IGNORE], ai: { ...DEFAULT_AI } });

export const configExists = (): boolean => existsSync(configFile());

export const loadConfig = (): Config => {
  const file = configFile();
  if (!existsSync(file)) return emptyConfig();
  const raw = readFileSync(file, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error(`config is not a JSON object: ${file}`);
  return {
    roots: readRoots(parsed['roots']),
    ignore: readIgnore(parsed['ignore']),
    ai: readAi(parsed['ai']),
  };
};

export const saveConfig = (config: Config): void => {
  withStateLock(configFile(), () => writeAtomic(configFile(), `${JSON.stringify(config, null, 2)}\n`));
};
