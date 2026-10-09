import { DEFAULT_DEPTH, MAX_DEPTH, WEIGHT_LIMIT } from '../config.js';

export const SETUP_USAGE = [
  'usage: cdai setup [--yes] [--ai|--no-ai] [--root <path>] [--depth <1-64>]',
  '                  [--weight <-1000..1000>] [--remove-root <path>]',
  '       --weight adds score points to every directory under --root, so it wins ties',
  '       --yes is required to accept roots without a terminal',
  '       first-time headless setup also requires --ai or --no-ai',
].join('\n');

export interface SetupOptions {
  readonly yes: boolean;
  readonly ai: boolean | null;
  readonly roots: readonly string[];
  readonly removeRoots: readonly string[];
  readonly depth: number;
  /** null keeps whatever weight the root already has. */
  readonly weight: number | null;
  readonly help: boolean;
}

type ParsedSetup = { readonly options: SetupOptions } | { readonly error: string };

const valueAfter = (args: readonly string[], index: number, option: string): string | ParsedSetup => {
  const value = args[index + 1];
  return value === undefined || value === '' ? { error: `${option} requires a path` } : value;
};

const integerIn = (value: string | undefined, min: number, max: number): number | null => {
  const parsed = value === undefined || value.trim() === '' ? Number.NaN : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

/** Integer options and their bounds, worded the way the error states them. */
const NUMERIC = {
  '--depth': { min: 1, max: MAX_DEPTH },
  '--weight': { min: -WEIGHT_LIMIT, max: WEIGHT_LIMIT },
} as const;

type NumericOption = keyof typeof NUMERIC;

const isNumeric = (arg: string | undefined): arg is NumericOption => arg === '--depth' || arg === '--weight';

const numericValue = (option: NumericOption, value: string | undefined): number | ParsedSetup => {
  const { min, max } = NUMERIC[option];
  const parsed = integerIn(value, min, max);
  return parsed ?? { error: `${option} must be an integer from ${String(min)} to ${String(max)}` };
};

export const parseSetupOptions = (args: readonly string[]): ParsedSetup => {
  let yes = false, help = false;
  let ai: boolean | null = null;
  const numbers: Partial<Record<NumericOption, number>> = {};
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
    } else if (isNumeric(arg)) {
      const value = numericValue(arg, args[++i]);
      if (typeof value !== 'number') return value;
      numbers[arg] = value;
    } else if (arg === '--help' || arg === '-h') help = true;
    else return { error: `unknown setup option: ${arg ?? ''}` };
  }
  const orphan = roots.length === 0 ? (Object.keys(numbers) as NumericOption[])[0] : undefined;
  if (orphan !== undefined) return { error: `${orphan} requires --root` };
  const depth = numbers['--depth'] ?? DEFAULT_DEPTH, weight = numbers['--weight'] ?? null;
  return { options: { yes, ai, roots, removeRoots, depth, weight, help } };
};
