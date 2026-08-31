import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { ensureDir } from '../paths.js';

const LOCK_WAIT_MS = 5;
const LOCK_TIMEOUT_MS = 5_000;
const INVALID_LOCK_GRACE_MS = 30_000;

interface LockOwner {
  readonly pid: number;
  readonly token: string;
  readonly createdAt: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseLockOwner = (value: unknown): LockOwner | null => {
  if (!isRecord(value)) return null;
  const { pid, token, createdAt } = value;
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0) return null;
  if (typeof token !== 'string' || token === '') return null;
  if (!Number.isSafeInteger(createdAt) || (createdAt as number) < 0) return null;
  return { pid: pid as number, token, createdAt: createdAt as number };
};

const readOwner = (ownerFile: string): LockOwner | null => {
  try {
    return parseLockOwner(JSON.parse(readFileSync(ownerFile, 'utf8')) as unknown);
  } catch {
    return null;
  }
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
};

const ageOf = (path: string, now: number): number => {
  try {
    return Math.max(0, now - statSync(path).mtimeMs);
  } catch {
    return 0;
  }
};

const canReclaim = (lockDir: string, ownerFile: string, now: number): boolean => {
  const owner = readOwner(ownerFile);
  if (owner !== null) return !processIsAlive(owner.pid);
  return ageOf(lockDir, now) > INVALID_LOCK_GRACE_MS;
};

const pause = (): void => {
  const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  Atomics.wait(signal, 0, 0, LOCK_WAIT_MS);
};

const isAlreadyExists = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'EEXIST';

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const quarantine = (lockDir: string): boolean => {
  const retired = `${lockDir}.trash.${process.pid}.${randomUUID()}`;
  try {
    renameSync(lockDir, retired);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  rmSync(retired, { recursive: true, force: true });
  return true;
};

const claimMarker = (marker: string): LockOwner | null => {
  const claimant: LockOwner = { pid: process.pid, token: randomUUID(), createdAt: Date.now() };
  while (true) {
    try {
      writeFileSync(marker, JSON.stringify(claimant), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      return claimant;
    } catch (error) {
      if (isMissing(error)) return null;
      if (!isAlreadyExists(error)) throw error;
      const holder = readOwner(marker);
      if (holder !== null && processIsAlive(holder.pid)) return null;
      const retired = `${marker}.trash.${process.pid}.${randomUUID()}`;
      try {
        renameSync(marker, retired);
        rmSync(retired, { force: true });
      } catch (renameError) {
        if (!isMissing(renameError)) throw renameError;
      }
    }
  }
};

const tryReclaim = (lockDir: string, ownerFile: string, now: number): boolean => {
  const marker = `${lockDir}/reclaim`;
  const claimant = claimMarker(marker);
  if (claimant === null) return false;
  if (readOwner(marker)?.token === claimant.token && canReclaim(lockDir, ownerFile, now)) {
    return quarantine(lockDir);
  }
  if (readOwner(marker)?.token === claimant.token) rmSync(marker, { force: true });
  return false;
};

const release = (lockDir: string, ownerFile: string, token: string): void => {
  if (readOwner(ownerFile)?.token !== token) return;
  quarantine(lockDir);
};

interface LockContext {
  readonly stateFile: string;
  readonly lockDir: string;
  readonly ownerFile: string;
  readonly started: number;
  readonly owner: LockOwner;
}

const acquire = (context: LockContext): void => {
  const { stateFile, lockDir, ownerFile, started, owner } = context;
  while (true) {
    try {
      mkdirSync(lockDir, { mode: 0o700 });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (!existsSync(lockDir)) continue;
      if (canReclaim(lockDir, ownerFile, Date.now())) tryReclaim(lockDir, ownerFile, Date.now());
      if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new Error(`state is busy: ${stateFile}`);
      pause();
      continue;
    }
    try {
      writeFileSync(ownerFile, JSON.stringify(owner), { encoding: 'utf8', mode: 0o600 });
      return;
    } catch (error) {
      quarantine(lockDir);
      throw error;
    }
  }
};

/** A small cross-process lock for short synchronous state transactions on macOS and Linux. */
export const withStateLock = <T>(stateFile: string, action: () => T): T => {
  const lockDir = `${stateFile}.lock`;
  const ownerFile = `${lockDir}/owner.json`;
  const started = Date.now();
  const owner: LockOwner = { pid: process.pid, token: randomUUID(), createdAt: started };
  ensureDir(dirname(stateFile));
  acquire({ stateFile, lockDir, ownerFile, started, owner });
  try {
    return action();
  } finally {
    release(lockDir, ownerFile, owner.token);
  }
};
