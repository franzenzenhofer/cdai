import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { resolveExecutable } from './executable.js';
import { contractTilde } from './paths.js';
import { note } from './protocol.js';

const TTY = '/dev/tty';
const FZF = 'fzf';
const READ_BUFFER_BYTES = 256;
const FZF_ARGS = ['--height=40%', '--reverse', '--prompt=cdai> '];

export interface PickerItem {
  readonly path: string;
  readonly label: string;
}

export const hasTty = (): boolean => existsSync(TTY) && canOpenTty();

const canOpenTty = (): boolean => {
  try {
    closeSync(openSync(TTY, 'r'));
    return true;
  } catch {
    return false;
  }
};

const pickWithFzf = (items: readonly PickerItem[]): string | null => {
  const input = items.map((item) => item.label).join('\n');
  const result = spawnSync(FZF, FZF_ARGS, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
  if (result.status !== 0) return null;
  const chosen = result.stdout.trim();
  const match = items.find((item) => item.label === chosen);
  return match?.path ?? null;
};

/** Null is "the terminal closed without answering"; "" is "the user pressed Enter". */
const readLineFromTty = (): string | null => {
  const fd = openSync(TTY, 'r');
  try {
    const buffer = Buffer.alloc(READ_BUFFER_BYTES);
    const bytes = readSync(fd, buffer, 0, READ_BUFFER_BYTES, null);
    return bytes === 0 ? null : buffer.toString('utf8', 0, bytes).trim();
  } finally {
    closeSync(fd);
  }
};

const pickNumbered = (items: readonly PickerItem[]): string | null => {
  items.forEach((item, i) => note(`  ${i + 1}) ${item.label}`));
  process.stderr.write('cdai: pick 1-' + items.length + ' (enter to abort): ');
  const choice = Number.parseInt(readLineFromTty() ?? '', 10);
  if (!Number.isFinite(choice) || choice < 1 || choice > items.length) return null;
  return items[choice - 1]?.path ?? null;
};

/** Yes/no on the terminal. Consent always fails closed when nobody can answer. */
export const confirm = (question: string): boolean => {
  if (!hasTty()) {
    note(`${question} [no terminal, declined]`);
    return false;
  }
  process.stderr.write(`${question} [Y/n] `);
  const answer = readLineFromTty();
  if (answer === null) {
    note('cdai: terminal closed before answering, declined');
    return false;
  }
  const lower = answer.toLowerCase();
  return lower === '' || lower === 'y' || lower === 'yes';
};

export const toItems = (paths: readonly string[]): PickerItem[] =>
  paths.map((path) => ({ path, label: contractTilde(path) }));

/** Returns the chosen path, or null when the user aborted or no terminal is available. */
export const pick = (items: readonly PickerItem[]): string | null => {
  if (items.length === 0) return null;
  if (!hasTty()) {
    note('cdai: several matches, no terminal to ask on:');
    items.forEach((item) => note(`  ${item.label}`));
    return null;
  }
  if (resolveExecutable(FZF) !== null) return pickWithFzf(items);
  return pickNumbered(items);
};
