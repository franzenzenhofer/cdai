import { describe, expect, it } from 'vitest';
import {
  hostLabels,
  isYear,
  pathNames,
  tokenize,
  tokenizeArgs,
  localNames,
  nameReadings,
} from '../src/match/tokenize.js';

describe('tokenize', () => {
  it('drops stopwords and keeps the search terms', () => {
    const parsed = tokenize('go to the petalworks folder');
    expect(parsed.tokens).toEqual(['petalworks']);
    expect(parsed.order).toBe('none');
    expect(tokenize('open this petalworks folder').tokens).toEqual(['petalworks']);
    expect(tokenize('show me that petalworks project').tokens).toEqual(['petalworks']);
  });

  it('searches a host by its name, not by its decoration', () => {
    expect(hostLabels('lumenlab.com')).toEqual(['lumenlab']);
    expect(hostLabels('www.lumenlab.com')).toEqual(['lumenlab']);
    expect(hostLabels('https://www.lumenlab.com/blog')).toEqual(['lumenlab']);
    expect(hostLabels('shop.petalworks.at')).toEqual(['petalworks']);
    expect(hostLabels('petalworks.co.uk')).toEqual(['petalworks']);
  });

  it('leaves a dotted word that is not a host alone', () => {
    expect(hostLabels('node.js')).toEqual([]);
    expect(hostLabels('vite.config')).toEqual([]);
    expect(hostLabels('.config')).toEqual([]);
  });

  it('keeps the typed word, because a directory can be named after the whole host', () => {
    expect(tokenize('nordwind.at').tokens).toEqual(['nordwind.at']);
    expect(tokenize('lumenlab.com website').tokens).toEqual(['lumenlab.com', 'website']);
  });

  it('reads a subdomain as its own name, and the domain as the next one', () => {
    expect(hostLabels('tidewheel.orbit.dev')).toEqual(['tidewheel', 'orbit']);
    expect(hostLabels('https://tidewheel.orbit.dev/level/7')).toEqual(['tidewheel', 'orbit']);
    expect(hostLabels('https://github.com/octocat/tidewheel')).toEqual([]);
    expect(hostLabels('tidewheel.pages.dev')).toEqual(['tidewheel']);
    expect(hostLabels('amt.wien.gv.at')).toEqual(['amt', 'wien']);
    expect(hostLabels('node.js')).toEqual([]);
  });

  it('reads the names a URL carries in its path, deepest first', () => {
    expect(pathNames('https://github.com/octocat/tidewheel')).toEqual(['tidewheel', 'octocat']);
    expect(pathNames('https://orbit.dev/blog/2026/07/tidewheel-ships.html'))
      .toEqual(['tidewheel-ships']);
    expect(pathNames('https:///stuff')).toEqual(['stuff']);
    expect(pathNames('orbit.dev')).toEqual([]);
    expect(pathNames('src/components')).toEqual([]);
  });

  it('offers the URL readings as later attempts, never as a replacement', () => {
    const readings = (input: string): string[][] =>
      nameReadings(tokenize(input)).map((reading) => [...reading.tokens]);
    expect(readings('lumenlab.com website')).toEqual([['lumenlab', 'website']]);
    expect(readings('the website of www.lumenlab.com')).toEqual([['website', 'lumenlab']]);
    expect(readings('https://tidewheel.orbit.dev/ game'))
      .toEqual([['tidewheel', 'game'], ['orbit', 'game']]);
    // What the link points at comes before what hosts it.
    expect(readings('https://orbit.dev/tidewheel')).toEqual([['tidewheel'], ['orbit']]);
    // Nobody's project is called "github", so the link is named by its path.
    expect(readings('https://github.com/octocat/tidewheel'))
      .toEqual([['tidewheel'], ['octocat']]);
    expect(readings('petalworks 2025')).toEqual([]);
    expect(readings('node.js')).toEqual([]);
  });

  it('reads a typed-out path as the names its segments carry', () => {
    expect(localNames('./dev/petalwroks')).toEqual(['petalwroks', 'dev']);
    expect(localNames('~/clients/petalworks/06-workshop')).toEqual(['06-workshop', 'petalworks', 'clients']);
    expect(localNames('/var/log/newsletter.html')).toEqual(['newsletter', 'log', 'var']);
    // A bare name and a link are read by the rules that already own them.
    expect(localNames('petalworks')).toEqual([]);
    expect(localNames('https://tidewheel.orbit.dev/level/7')).toEqual([]);
  });

  it('preserves stopwords when they are the only possible directory name', () => {
    expect(tokenize('project').tokens).toEqual(['project']);
    expect(tokenize('the folder').tokens).toEqual(['the', 'folder']);
    expect(tokenize('open').tokens).toEqual(['open']);
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
