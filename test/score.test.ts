import { describe, expect, it } from 'vitest';
import { SCORE } from '../src/match/constants.js';
import { fuzzyScore, matchName, rankCandidates, scoreCandidate, type Candidate, type ScoreContext } from '../src/match/score.js';
import { tokenize } from '../src/match/tokenize.js';

const candidate = (path: string, mtime = 0, root = '/roots/dev'): Candidate => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  mtime,
  root,
});

const context = (frecency: ReadonlyArray<readonly [string, number]> = [], cwd = '/nowhere'): ScoreContext => ({
  cwd,
  frecencyByPath: new Map(frecency),
});

describe('matchName', () => {
  it('ranks the match classes in the documented order', () => {
    expect(matchName('squash', 'squash')).toBe(SCORE.exact);
    expect(matchName('squi', 'squash')).toBe(SCORE.prefix);
    expect(matchName('3d', 'tabletop-3d')).toBe(SCORE.wordBoundary);
    expect(matchName('works', 'petalworks')).toBe(SCORE.substring);
    expect(matchName('sqh', 'squash')).toBeGreaterThan(SCORE.none);
    expect(matchName('sqh', 'squash')).toBeLessThanOrEqual(SCORE.fuzzyMax);
    expect(matchName('zzz', 'squash')).toBe(SCORE.none);
  });

  it('is case insensitive', () => {
    expect(matchName('squash', 'SQUASH')).toBe(SCORE.exact);
  });
});

describe('fuzzyScore', () => {
  it('rewards dense matches over scattered ones', () => {
    expect(fuzzyScore('abc', 'abcxxxxxxxx')).toBeGreaterThan(fuzzyScore('abc', 'axbxcxxxxxx'));
  });

  it('returns zero when the characters are out of order', () => {
    expect(fuzzyScore('cba', 'abc')).toBe(SCORE.none);
  });
});

describe('scoreCandidate', () => {
  it('requires every token to match somewhere', () => {
    const query = tokenize('squash zzzz');
    expect(scoreCandidate(query, candidate('/roots/dev/squash'), context())).toBe(SCORE.none);
  });

  it('lets a token match the parent path at a lower class', () => {
    const query = tokenize('petalworks 2026x');
    const scored = scoreCandidate(
      tokenize('petalworks src'),
      candidate('/roots/clients/petalworks/src'),
      context(),
    );
    expect(query.tokens).toHaveLength(2);
    expect(scored).toBeGreaterThan(SCORE.none);
  });

  it('adds a frecency bonus', () => {
    const query = tokenize('squash');
    const cold = scoreCandidate(query, candidate('/roots/dev/squash'), context());
    const hot = scoreCandidate(query, candidate('/roots/dev/squash'), context([['/roots/dev/squash', 30]]));
    expect(hot).toBeGreaterThan(cold);
  });

  it('prefers a directory below the current one', () => {
    const query = tokenize('squash');
    const plain = scoreCandidate(query, candidate('/roots/dev/squash'), context());
    const nearby = scoreCandidate(query, candidate('/roots/dev/squash'), context([], '/roots/dev'));
    expect(nearby).toBeGreaterThan(plain);
  });

  it('enforces year tokens as a hard filter', () => {
    const query = tokenize('petalworks 2025');
    expect(scoreCandidate(query, candidate('/c/petalworks/petalworks-2026'), context())).toBe(SCORE.none);
    expect(scoreCandidate(query, candidate('/c/petalworks/petalworks-2025'), context())).toBeGreaterThan(SCORE.none);
  });

  it('enforces the "in <root>" filter', () => {
    const query = tokenize('squash in clients');
    expect(scoreCandidate(query, candidate('/roots/dev/squash'), context())).toBe(SCORE.none);
    expect(
      scoreCandidate(query, candidate('/roots/clients/squash', 0, '/roots/clients'), context()),
    ).toBeGreaterThan(SCORE.none);
  });

  it('prefers the shorter name at an equal match class', () => {
    const query = tokenize('petal');
    const short = scoreCandidate(query, candidate('/c/petalworks'), context());
    const long = scoreCandidate(query, candidate('/c/petalworks-2026'), context());
    expect(short).toBeGreaterThan(long);
  });
});

describe('rankCandidates', () => {
  it('sorts by score and drops non matches', () => {
    const ranked = rankCandidates(
      tokenize('squash'),
      [candidate('/roots/dev/orbit'), candidate('/roots/dev/squash'), candidate('/roots/dev/squash-old')],
      context(),
    );
    expect(ranked.map((r) => r.candidate.name)).toEqual(['squash', 'squash-old']);
  });

  it('is deterministic for equal scores', () => {
    const items = [candidate('/b/thing'), candidate('/a/thing')];
    const ranked = rankCandidates(tokenize('thing'), items, context());
    expect(ranked.map((r) => r.candidate.path)).toEqual(['/a/thing', '/b/thing']);
  });
});
