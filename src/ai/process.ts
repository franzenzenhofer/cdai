import { spawn } from 'node:child_process';
import { aiArgs, type AiBackend } from './backend.js';
import { flattenText } from './text.js';

const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 4096;
const MAX_STDERR_EXCERPT = 120;
const KILL_GRACE_MS = 250;
type KillSignal = 'SIGTERM' | 'SIGKILL';

const spawnBackend = (backend: AiBackend, prompt: string) =>
  spawn(backend.command, aiArgs(backend, prompt), {
    detached: process.platform !== 'win32',
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const terminateBackend = (child: ReturnType<typeof spawnBackend>, signal: KillSignal): void => {
  try {
    if (process.platform !== 'win32' && child.pid !== undefined) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The whole process group has already exited.
  }
};

const abortBackend = (
  child: ReturnType<typeof spawnBackend>,
  error: Error,
  finish: (error: Error) => void,
): void => {
  terminateBackend(child, 'SIGTERM');
  child.stdout.destroy();
  child.stderr.destroy();
  const escalation = setTimeout(() => terminateBackend(child, 'SIGKILL'), KILL_GRACE_MS);
  escalation.unref();
  finish(error);
};

interface OutputBuffer {
  text: string;
  bytes: number;
}

const collectOutput = (
  child: ReturnType<typeof spawnBackend>,
  output: OutputBuffer,
  abort: (error: Error) => void,
  label: string,
): void => {
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output.text += chunk;
    output.bytes += Buffer.byteLength(chunk);
    if (output.bytes > MAX_OUTPUT_BYTES) abort(new Error(`${label} output exceeded 1 MiB`));
  });
};

/** Read and drop the tail: an unread stderr pipe eventually blocks the backend mid answer. */
const collectDiagnostics = (
  child: ReturnType<typeof spawnBackend>,
  diagnostics: OutputBuffer,
): void => {
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (diagnostics.bytes >= MAX_STDERR_BYTES) return;
    diagnostics.text += chunk;
    diagnostics.bytes += Buffer.byteLength(chunk);
  });
};

/**
 * A backend that failed says why on stderr - "error: unknown option '--safe-mode'", an expired
 * login, a missing model. Dropping that leaves the user with a bare exit code and no next step.
 */
const exitError = (label: string, code: number | null, diagnostics: string): Error => {
  const detail = flattenText(diagnostics, MAX_STDERR_EXCERPT);
  const suffix = detail === '' ? '' : `: ${detail}`;
  return new Error(`${label} exited with ${String(code)}${suffix}`);
};

export const runAiCommand = (
  backend: AiBackend,
  prompt: string,
  timeoutMs: number,
): Promise<string> =>
  new Promise((resolveOutput, reject) => {
    const child = spawnBackend(backend, prompt);
    const output: OutputBuffer = { text: '', bytes: 0 };
    const diagnostics: OutputBuffer = { text: '', bytes: 0 };
    let settled = false;
    const finish = (error: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error === null) resolveOutput(output.text);
      else reject(error);
    };
    const abort = (error: Error): void => {
      if (!settled) abortBackend(child, error, finish);
    };
    const timer = setTimeout(
      () => abort(new Error(`${backend.kind} timed out after ${String(timeoutMs)}ms`)),
      timeoutMs,
    );
    collectOutput(child, output, abort, backend.kind);
    collectDiagnostics(child, diagnostics);
    child.on('error', finish);
    child.on('close', (code) =>
      finish(code === 0 ? null : exitError(backend.kind, code, diagnostics.text)));
  });
