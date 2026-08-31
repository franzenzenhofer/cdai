import { basename } from 'node:path';
import type { AiConfig } from '../config.js';
import { resolveExecutable } from '../executable.js';
import { claudeArgs } from './claude.js';

export type AiBackendKind = 'apfel' | 'claude' | 'gemini' | 'ollama' | 'custom';

export interface AiBackend {
  readonly kind: AiBackendKind;
  readonly command: string;
  readonly model: string;
  readonly extraArgs: readonly string[];
}

type CommandResolver = (command: string) => string | null;

const AUTO_COMMANDS = ['apfel', 'claude', 'gemini'] as const;
const DEFAULT_MODEL: Readonly<Partial<Record<AiBackendKind, string>>> = { claude: 'sonnet' };

export const backendKind = (command: string): AiBackendKind => {
  const name = basename(command).toLowerCase();
  if (name === 'apfel') return 'apfel';
  if (name === 'claude') return 'claude';
  if (name === 'gemini') return 'gemini';
  if (name === 'ollama') return 'ollama';
  return 'custom';
};

const backend = (command: string, ai: AiConfig): AiBackend => {
  const kind = backendKind(command);
  return {
    kind,
    command,
    model: ai.model.trim() || DEFAULT_MODEL[kind] || '',
    extraArgs: ai.args,
  };
};

const resolveAuto = (ai: AiConfig, resolveCommand: CommandResolver): AiBackend | null => {
  for (const command of AUTO_COMMANDS) {
    const executable = resolveCommand(command);
    if (executable !== null) return backend(executable, ai);
  }
  if (ai.model.trim() !== '') {
    const ollama = resolveCommand('ollama');
    if (ollama !== null) return backend(ollama, ai);
  }
  return null;
};

export const resolveAiBackend = (
  ai: AiConfig,
  resolveCommand: CommandResolver = resolveExecutable,
): AiBackend | null => {
  if (ai.command === 'auto') return resolveAuto(ai, resolveCommand);
  const executable = resolveCommand(ai.command);
  if (executable === null) return null;
  const resolved = backend(executable, ai);
  return resolved.kind === 'ollama' && resolved.model === '' ? null : resolved;
};

const modelArgs = (model: string): string[] => (model === '' ? [] : ['--model', model]);

const customArgs = (backend: AiBackend, prompt: string): string[] => {
  const hasPrompt = backend.extraArgs.some((arg) => arg.includes('{prompt}'));
  const expanded = backend.extraArgs.map((arg) =>
    arg.replaceAll('{model}', backend.model).replaceAll('{prompt}', prompt),
  );
  return hasPrompt ? expanded : [...expanded, prompt];
};

export const aiArgs = (backend: AiBackend, prompt: string): string[] => {
  if (backend.kind === 'apfel') {
    return [...backend.extraArgs, '-o', 'json', '--temperature', '0', '--max-tokens', '192', '--', prompt];
  }
  if (backend.kind === 'claude') return claudeArgs(backend.extraArgs, backend.model, prompt);
  if (backend.kind === 'gemini') {
    return [...backend.extraArgs, ...modelArgs(backend.model), '--output-format', 'json', '--prompt', prompt];
  }
  if (backend.kind === 'ollama') {
    return ['run', backend.model, ...backend.extraArgs, '--format', 'json', prompt];
  }
  return customArgs(backend, prompt);
};

export const backendLabel = (backend: AiBackend): string =>
  backend.model === '' ? backend.kind : `${backend.kind} ${backend.model}`;
