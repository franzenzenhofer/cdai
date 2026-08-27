import { describe, expect, it } from 'vitest';
import { isYear, tokenize, tokenizeArgs } from '../src/match/tokenize.js';

describe('tokenize', () => {
  it('drops stopwords and keeps the search terms', () => {
    const parsed = tokenize('go to the petalworks folder');
    expect(parsed.tokens).toEqual(['petalworks']);
    expect(parsed.order).toBe('none');
  });

  it('recognises the latest operator', () => {
    const parsed = tokenize('latest petalworks folder');
    expect(parsed.order).toBe('latest');
    expect(parsed.tokens).toEqual(['petalworks']);
  });

  it('recognises the oldest operator', () => {
    expect(tokenize('oldest petalworks').order).toBe('oldest');
    expect(tokenize('first petalworks').order).toBe('oldest');
  });

  it('parses "in <root>" before stopword removal', () => {
    const parsed = tokenize('squash in dev');
    expect(parsed.rootFilter).toBe('dev');
    expect(parsed.tokens).toEqual(['squash']);
  });

  it('treats a trailing bare "in" as a stopword', () => {
    const parsed = tokenize('squash in');
    expect(parsed.rootFilter).toBeNull();
    expect(parsed.tokens).toEqual(['squash']);
  });

  it('pulls year tokens out as required substrings', () => {
    const parsed = tokenize('petalworks 2025');
    expect(parsed.years).toEqual(['2025']);
    expect(parsed.tokens).toEqual(['petalworks']);
  });

  it('only accepts plausible years', () => {
    expect(isYear('2026')).toBe(true);
    expect(isYear('1989')).toBe(false);
    expect(isYear('123')).toBe(false);
    expect(isYear('3d')).toBe(false);
  });

  it('lowercases and joins argv', () => {
    expect(tokenizeArgs(['PetalWorks', 'Folder']).tokens).toEqual(['petalworks']);
  });

  it('keeps the raw query for messages', () => {
    expect(tokenize('that client with the flowers').raw).toBe('that client with the flowers');
  });
});
