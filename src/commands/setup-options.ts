import { DEFAULT_DEPTH, MAX_DEPTH } from '../config.js';

export const SETUP_USAGE = [
  'usage: cdai setup [--yes] [--ai|--no-ai] [--root <path>] [--depth <1-64>]',
  '                  [--remove-root <path>]',
  '       --yes is required to accept roots without a terminal',
  '       first-time headless setup also requires --ai or --no-ai',
].join('\n');

export interface SetupOptions {
  readonly yes: boolean;
  readonly ai: boolean | null;
  readonly roots: readonly string[];
  readonly removeRoots: readonly string[];
  readonly depth: number;
  readonly help: boolean;
}

type ParsedSetup = { readonly options: SetupOptions } | { readonly error: string };

const valueAfter = (args: readonly string[], index: number, option: string): string | ParsedSetup => {
  const value = args[index + 1];
  return value === undefined || value === '' ? { error: `${option} requires a path` } : value;
};

const validDepth = (value: string | undefined): number | null => {
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_DEPTH ? parsed : null;
};

export const parseSetupOptions = (args: readonly string[]): ParsedSetup => {
  let yes = false, depthSet = false, help = false;
  let ai: boolean | null = null;
  let depth = DEFAULT_DEPTH;
  const roots: string[] = [], removeRoots: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--yes') yes = true;
    else if (arg === '--ai' || arg === '--no-ai') {
      const next = arg === '--ai';
      if (ai !== null && ai !== next) return { error: 'choose either --ai or --no-ai, not both' };
      ai = next;
    } else if (arg === '--root' || arg === '--remove-root') {
      const value = valueAfter(args, i, arg);
      if (typeof value !== 'string') return value;
      (arg === '--root' ? roots : removeRoots).push(value);
      i += 1;
    } else if (arg === '--depth') {
      const parsed = validDepth(args[++i]);
      if (parsed === null) {
        return { error: `--depth must be an integer from 1 to ${String(MAX_DEPTH)}` };
      }
      depth = parsed;
      depthSet = true;
    } else if (arg === '--help' || arg === '-h') help = true;
    else return { error: `unknown setup option: ${arg ?? ''}` };
  }
  if (depthSet && roots.length === 0) return { error: '--depth requires --root' };
  return { options: { yes, ai, roots, removeRoots, depth, help } };
};
