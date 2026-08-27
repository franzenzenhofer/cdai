import { readFileSync, existsSync } from 'node:fs';
import { absolutize, configFile, writeAtomic } from './paths.js';

export const DEFAULT_DEPTH = 2;
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
  command: 'claude',
  args: [] as string[],
  model: 'sonnet',
  /** Measured `claude -p` round trip on a warm machine is 13 to 17s, so 20s would be a coin flip. */
  timeoutMs: 45_000,
} as const;

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
  const roots: RootConfig[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      roots.push({ path: absolutize(entry), depth: DEFAULT_DEPTH });
      continue;
    }
    if (!isRecord(entry) || typeof entry['path'] !== 'string') continue;
    const depth = entry['depth'];
    roots.push({
      path: absolutize(entry['path']),
      depth: typeof depth === 'number' && depth > 0 ? Math.floor(depth) : DEFAULT_DEPTH,
    });
  }
  return roots;
};

const readAi = (value: unknown): AiConfig => {
  if (!isRecord(value)) return { ...DEFAULT_AI };
  const args = value['args'];
  return {
    enabled: typeof value['enabled'] === 'boolean' ? value['enabled'] : DEFAULT_AI.enabled,
    command: typeof value['command'] === 'string' ? value['command'] : DEFAULT_AI.command,
    args: Array.isArray(args) ? args.filter((a): a is string => typeof a === 'string') : [],
    model: typeof value['model'] === 'string' ? value['model'] : DEFAULT_AI.model,
    timeoutMs:
      typeof value['timeoutMs'] === 'number' && value['timeoutMs'] > 0
        ? value['timeoutMs']
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
  writeAtomic(configFile(), `${JSON.stringify(config, null, 2)}\n`);
};
