import { describe, expect, it } from 'vitest';
import { stripCdOptions } from '../src/shell/control.js';

describe('stripCdOptions', () => {
  it('removes recognized leading zsh and Bash flags', () => {
    expect(stripCdOptions(['-P', '-e', 'petal'])).toEqual(['petal']);
    expect(stripCdOptions(['-qLP', 'petal', '2025'])).toEqual(['petal', '2025']);
  });

  it('honours the option terminator and preserves invalid or later option-like words', () => {
    expect(stripCdOptions(['--', '-literal'])).toEqual(['-literal']);
    expect(stripCdOptions(['-Z', 'petal'])).toEqual(['-Z', 'petal']);
    expect(stripCdOptions(['petal', '-P'])).toEqual(['petal', '-P']);
  });
});
