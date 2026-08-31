import { spawn } from 'node:child_process';
import { aiArgs, type AiBackend } from './backend.js';

const MAX_OUTPUT_BYTES = 1024 * 1024;
const KILL_GRACE_MS = 250;
type KillSignal = 'SIGTERM' | 'SIGKILL';

const spawnBackend = (backend: AiBackend, prompt: string) =>
  spawn(backend.command, aiArgs(backend, prompt), {
    detached: process.platform !== 'win32',
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'ignore'],
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

export const runAiCommand = (
  backend: AiBackend,
  prompt: string,
  timeoutMs: number,
): Promise<string> =>
  new Promise((resolveOutput, reject) => {
    const child = spawnBackend(backend, prompt);
    const output: OutputBuffer = { text: '', bytes: 0 };
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
    child.on('error', finish);
    child.on('close', (code) =>
      finish(code === 0 ? null : new Error(`${backend.kind} exited with ${String(code)}`)));
  });
