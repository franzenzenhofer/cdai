import { readFileSync } from 'node:fs';

/** Derived cache files may be partial after a crash; callers can safely rebuild on undefined. */
export const tryReadJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
};
