import { describe, expect, it } from 'vitest';
import { hostLabel, hostReduced, isYear, tokenize, tokenizeArgs } from '../src/match/tokenize.js';

describe('tokenize', () => {
  it('drops stopwords and keeps the search terms', () => {
    const parsed = tokenize('go to the petalworks folder');
    expect(parsed.tokens).toEqual(['petalworks']);
    expect(parsed.order).toBe('none');
  });

  it('searches a host by its name, not by its decoration', () => {
    expect(hostLabel('lumenlab.com')).toBe('lumenlab');
    expect(hostLabel('www.lumenlab.com')).toBe('lumenlab');
    expect(hostLabel('https://www.lumenlab.com/blog')).toBe('lumenlab');
    expect(hostLabel('shop.petalworks.at')).toBe('petalworks');
    expect(hostLabel('petalworks.co.uk')).toBe('petalworks');
  });

  it('leaves a dotted word that is not a host alone', () => {
    expect(hostLabel('node.js')).toBe('node.js');
    expect(hostLabel('vite.config')).toBe('vite.config');
    expect(hostLabel('.config')).toBe('.config');
  });

  it('keeps the typed word, because a directory can be named after the whole host', () => {
    expect(tokenize('nordwind.at').tokens).toEqual(['nordwind.at']);
    expect(tokenize('lumenlab.com website').tokens).toEqual(['lumenlab.com', 'website']);
  });

  it('offers the host reading as a second attempt, never as a replacement', () => {
    expect(hostReduced(tokenize('lumenlab.com website'))?.tokens).toEqual(['lumenlab', 'website']);
    expect(hostReduced(tokenize('the website of www.lumenlab.com'))?.tokens)
      .toEqual(['website', 'lumenlab']);
    expect(hostReduced(tokenize('petalworks 2025'))).toBeNull();
    expect(hostReduced(tokenize('node.js'))).toBeNull();
  });

  it('preserves stopwords when they are the only possible directory name', () => {
    expect(tokenize('project').tokens).toEqual(['project']);
    expect(tokenize('the folder').tokens).toEqual(['the', 'folder']);
  });

  it('preserves a lone operator or year as a literal directory name', () => {
    expect(tokenize('latest')).toMatchObject({ tokens: ['latest'], order: 'none', years: [] });
    expect(tokenize('oldest')).toMatchObject({ tokens: ['oldest'], order: 'none', years: [] });
    expect(tokenize('2025')).toMatchObject({ tokens: ['2025'], order: 'none', years: [] });
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
