import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveExecutable } from '../src/executable.js';

describe('resolveExecutable', () => {
  it('finds commands on PATH and accepts explicit executable paths', () => {
    expect(resolveExecutable('node')).not.toBeNull();
    expect(resolveExecutable(process.execPath)).toBe(resolve(process.execPath));
  });

  it('rejects empty, missing, and non-executable file paths', () => {
    expect(resolveExecutable('  ')).toBeNull();
    expect(resolveExecutable('/definitely/not/a/command')).toBeNull();
    expect(resolveExecutable(resolve('package.json'))).toBeNull();
  });
});
