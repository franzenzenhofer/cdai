import { basename } from 'node:path';
import { DEFAULT_AI, DEFAULT_IGNORE, loadConfig, saveConfig, type Config, type RootConfig } from '../config.js';
import { configFile, contractTilde } from '../paths.js';
import { confirm } from '../picker.js';
import { EXIT, note, type ExitCode } from '../protocol.js';
import { refreshIndex } from '../store/indexer.js';
import { detectRoots } from './detect.js';

const SHELL_LINES: Record<string, string> = {
  zsh: 'eval "$(cdai init zsh)"   # in ~/.zshrc',
  bash: 'eval "$(cdai init bash)"  # in ~/.bashrc',
  fish: 'cdai init fish | source   # in ~/.config/fish/config.fish',
};
const DEFAULT_SHELL = 'zsh';

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

export const runSetup = (args: readonly string[]): ExitCode => {
  const all = args.includes('--yes');
  const existing = loadConfig();
  const candidates = detectRoots().filter(
    (root) => !existing.roots.some((known) => known.path === root.path),
  );
  if (candidates.length === 0 && existing.roots.length === 0) {
    note('cdai: found no obvious project roots, add them by hand:');
    note(`      ${configFile()}`);
    return EXIT.error;
  }
  note('cdai: detected these project roots');
  const config: Config = {
    roots: mergeRoots(existing.roots, acceptedRoots(candidates, all)),
    ignore: existing.ignore.length > 0 ? existing.ignore : [...DEFAULT_IGNORE],
    ai: existing.roots.length > 0 ? existing.ai : { ...DEFAULT_AI },
  };
  saveConfig(config);
  note(`cdai: wrote ${configFile()}`);
  const index = refreshIndex(config);
  note(`cdai: indexed ${index.entries.length} directories`);
  note('cdai: add this line to your shell config, then open a new shell');
  note(`      ${SHELL_LINES[currentShell()] ?? SHELL_LINES[DEFAULT_SHELL] ?? ''}`);
  return EXIT.ok;
};
