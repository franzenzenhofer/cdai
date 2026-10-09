import type { RootConfig } from '@franzenzenhofer/intent-core/store/indexer';
import type { AiConfig } from '@franzenzenhofer/intent-core/ai/backend';

export type { RootConfig, AiConfig };

export const DEFAULT_DEPTH = 2;
export const MAX_DEPTH = 64;
export const MAX_TIMER_MS = 2_147_483_647;
/** Bound on a root's weight, in score points; an exact name match is worth 1000. */
export const WEIGHT_LIMIT = 1000;
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

/**
 * A configured place to crawl. `weight` is score points added to every directory under it: it
 * never beats a better name match, but decides between equally good ones.
 */
export interface CdaiRoot extends RootConfig {
  readonly weight?: number;
}

/** Words declared in config.json for one directory; they win over every other answer. */
export interface ConfigAlias {
  readonly query: string;
  readonly path: string;
}

export interface Config {
  readonly roots: readonly CdaiRoot[];
  readonly ignore: readonly string[];
  readonly ai: AiConfig;
  readonly aliases: readonly ConfigAlias[];
}
