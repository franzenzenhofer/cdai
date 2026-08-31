import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { backendLabel, resolveAiBackend } from '../ai/backend.js';
import {
  DEFAULT_AI,
  DEFAULT_IGNORE,
  loadConfig,
  saveConfig,
  type AiConfig,
  type Config,
  type RootConfig,
} from '../config.js';
import { absolutize, configFile, contractTilde } from '../paths.js';
import { confirm, hasTty } from '../picker.js';
import { EXIT, fail, note, type ExitCode } from '../protocol.js';
import { refreshIndex } from '../store/indexer.js';
import { detectRoots } from './detect.js';
import { parseSetupOptions, SETUP_USAGE, type SetupOptions } from './setup-options.js';

const SHELL_LINES: Record<string, string> = {
  zsh: 'eval "$(cdai init zsh)"   # in ~/.zshrc',
  bash: 'eval "$(cdai init bash)"  # in ~/.bashrc',
  fish: 'cdai init fish | source   # in ~/.config/fish/config.fish',
};
const DEFAULT_SHELL = 'zsh';
const AI_DISCLOSURE = 'vague queries, current directory, and candidate directory paths may be sent to that backend';
export { parseSetupOptions, SETUP_USAGE } from './setup-options.js';

export const currentShell = (): string => {
  const shell = process.env['SHELL'];
  if (shell === undefined || shell === '') return DEFAULT_SHELL;
  const name = basename(shell);
  return name in SHELL_LINES ? name : DEFAULT_SHELL;
};

const mergeRoots = (existing: readonly RootConfig[], added: readonly RootConfig[]): RootConfig[] => {
  const byPath = new Map(existing.map((root) => [root.path, root]));
  for (const root of added) byPath.set(root.path, root);
  return [...byPath.values()];
};

const acceptedRoots = (candidates: readonly RootConfig[], all: boolean): RootConfig[] => {
  if (!all) {
    return candidates.filter((root) =>
      confirm(`cdai: learn ${contractTilde(root.path)} (depth ${root.depth})?`),
    );
  }
  candidates.forEach((root) => note(`      ${contractTilde(root.path)} (depth ${root.depth})`));
  return [...candidates];
};

const selectedAi = (existing: Config, choice: boolean | null, all: boolean): AiConfig => {
  if (choice !== null) return { ...existing.ai, enabled: choice };
  if (existing.roots.length > 0) return existing.ai;
  if (all) return { ...DEFAULT_AI, enabled: false };
  const backend = resolveAiBackend(DEFAULT_AI);
  const label = backend === null ? 'auto-detected backend when available' : backendLabel(backend);
  const enabled = confirm(`cdai: enable optional AI fallback via ${label}? ${AI_DISCLOSURE}`);
  return { ...DEFAULT_AI, enabled };
};

const reportAi = (ai: AiConfig): void => {
  if (!ai.enabled) {
    note('cdai: AI fallback disabled (enable later with `cdai setup --ai`)');
    return;
  }
  const backend = resolveAiBackend(ai);
  note(`cdai: AI fallback enabled via ${backend === null ? ai.command : backendLabel(backend)}`);
  note(`      ${AI_DISCLOSURE}`);
  note('      disable it any time with `cdai setup --no-ai`');
};

const explicitRootConfigs = (options: SetupOptions): RootConfig[] | null => {
  const roots: RootConfig[] = [];
  for (const raw of options.roots) {
    const path = absolutize(raw);
    try {
      if (!statSync(path).isDirectory()) throw new Error('not a directory');
    } catch {
      fail(`setup root is not an existing directory: ${contractTilde(path)}`);
      return null;
    }
    roots.push({ path, depth: options.depth });
  }
  return roots;
};

const setupCandidates = (
  existing: readonly RootConfig[],
  explicit: readonly RootConfig[],
  detected: readonly RootConfig[],
): RootConfig[] => {
  const candidates = new Map(explicit.map((root) => [root.path, root]));
  for (const root of detected) {
    if (!candidates.has(root.path) && !existing.some((known) => known.path === root.path)) {
      candidates.set(root.path, root);
    }
  }
  return [...candidates.values()].filter((root) =>
    !existing.some((known) => known.path === root.path && known.depth === root.depth),
  );
};

const headlessConsentError = (
  options: SetupOptions,
  firstSetup: boolean,
  explicitChange: boolean,
): string | null => {
  if (firstSetup && (!options.yes || options.ai === null)) {
    return 'headless first-time setup needs explicit root acceptance and an AI choice';
  }
  if (explicitChange && !options.yes) return 'headless root additions or depth changes need --yes';
  return null;
};

const saveAndReport = (config: Config, removed: ReadonlySet<string>): ExitCode => {
  saveConfig(config);
  note(`cdai: wrote ${configFile()}`);
  removed.forEach((path) => note(`cdai: removed root ${contractTilde(path)}`));
  reportAi(config.ai);
  const index = refreshIndex(config);
  note(`cdai: indexed ${index.entries.length} directories`);
  if (index.truncated !== null) note(`cdai: warning: index is partial (${index.truncated} limit)`);
  note('cdai: if not already present, add this line to your shell config');
  note(`      ${SHELL_LINES[currentShell()] ?? SHELL_LINES[DEFAULT_SHELL] ?? ''}`);
  note('cdai: reload that shell to activate the latest integration');
  return index.truncated === null ? EXIT.ok : EXIT.error;
};

const writeSetup = (existing: Config, options: SetupOptions, candidates: RootConfig[]): ExitCode => {
  if (candidates.length > 0) note('cdai: proposed project roots');
  const accepted = acceptedRoots(candidates, options.yes);
  const removed = new Set(options.removeRoots.map(absolutize));
  const independentChange = options.ai !== null || removed.size > 0;
  if (candidates.length > 0 && accepted.length === 0 && !independentChange) {
    note('cdai: setup cancelled; no proposed root accepted and nothing was written');
    return EXIT.noCd;
  }
  const retained = existing.roots.filter((root) => !removed.has(root.path));
  const roots = mergeRoots(retained, accepted);
  if (roots.length === 0 && removed.size === 0) {
    note('cdai: setup cancelled; no roots selected and nothing was written');
    return EXIT.noCd;
  }
  const config: Config = {
    roots,
    ignore: existing.ignore.length > 0 ? existing.ignore : [...DEFAULT_IGNORE],
    ai: selectedAi(existing, options.ai, options.yes),
  };
  return saveAndReport(config, removed);
};

interface SetupPlan {
  readonly candidates: readonly RootConfig[];
  readonly explicit: readonly RootConfig[];
  readonly removed: readonly string[];
}

const planSetup = (existing: Config, options: SetupOptions): SetupPlan | null => {
  const explicit = explicitRootConfigs(options);
  if (explicit === null) return null;
  const removed = options.removeRoots.map(absolutize);
  const unknown = removed.find((path) => !existing.roots.some((root) => root.path === path));
  if (unknown !== undefined) {
    fail(`root is not configured: ${contractTilde(unknown)}`);
    return null;
  }
  if (explicit.some((root) => removed.includes(root.path))) {
    fail('the same root cannot be added and removed in one setup command');
    return null;
  }
  const retained = existing.roots.filter((root) => !removed.includes(root.path));
  const detected = detectRoots().filter((root) => !removed.includes(root.path));
  return { candidates: setupCandidates(retained, explicit, detected), explicit, removed };
};

export const runSetup = (args: readonly string[]): ExitCode => {
  const parsed = parseSetupOptions(args);
  if ('error' in parsed) {
    fail(parsed.error, SETUP_USAGE);
    return EXIT.error;
  }
  const options = parsed.options;
  if (options.help) {
    note(SETUP_USAGE);
    return EXIT.ok;
  }
  const existing = loadConfig();
  const terminal = hasTty();
  const plan = planSetup(existing, options);
  if (plan === null) return EXIT.error;
  const explicitChange = plan.candidates.some((candidate) =>
    plan.explicit.some((root) => root.path === candidate.path),
  );
  const consentError = terminal ? null : headlessConsentError(options, existing.roots.length === 0, explicitChange);
  if (consentError !== null) {
    fail(consentError, SETUP_USAGE);
    return EXIT.error;
  }
  if (plan.candidates.length === 0 && existing.roots.length === 0 && plan.removed.length === 0) {
    fail('found no project roots', 'run `cdai setup --root <path> --yes --ai|--no-ai`');
    return EXIT.error;
  }
  return writeSetup(existing, options, [...plan.candidates]);
};
