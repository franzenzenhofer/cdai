import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { THRESHOLD } from '../src/match/constants.js';
import { buildCandidates, collapseChains, decide, looseCandidates, resolveQuery, type Decision, type ResolveInput } from '../src/match/resolve.js';
import type { ScoredCandidate } from '../src/match/score.js';
import { tokenize } from '../src/match/tokenize.js';
import { emptyDb, type Db } from '../src/store/db.js';
import { buildIndex } from '../src/store/indexer.js';
import { makeFixture, writeConfig, type Fixture } from './fixtures.js';

let fixture: Fixture;
let input: ResolveInput;
const NOW_SECONDS = Math.floor(Date.now() / 1000);

const withDb = (db: Db): ResolveInput => ({ ...input, db });

beforeEach(() => {
  fixture = makeFixture();
  process.env['CDAI_CONFIG_DIR'] = fixture.configDir;
  process.env['CDAI_DATA_DIR'] = fixture.dataDir;
  writeConfig(fixture);
  input = {
    index: buildIndex(loadConfig()),
    db: emptyDb(),
    cwd: fixture.rootDir,
    nowSeconds: NOW_SECONDS,
  };
});

afterEach(() => {
  fixture.cleanup();
  delete process.env['CDAI_CONFIG_DIR'];
  delete process.env['CDAI_DATA_DIR'];
});

const run = (query: string, over: ResolveInput = input): Decision => tokenizeThen(query, over);
const tokenizeThen = (query: string, over: ResolveInput): Decision => resolveQuery(tokenize(query), over);

describe('resolveQuery', () => {
  it('jumps straight to a clear single match', () => {
    const decision = run('almanac');
    expect(decision.kind).toBe('hit');
    expect(decision.kind === 'hit' && decision.path).toBe(`${fixture.projects}/almanac`);
  });

  it('collapses a client folder and its year folder into one answer', () => {
    const decision = run('petal');
    expect(decision.kind).toBe('hit');
    expect(decision.kind === 'hit' && decision.path).toBe(`${fixture.clients}/petalworks`);
  });

  it('prefers the folder literally named after the host over the host reading', () => {
    const decision = run('nordwind.at');
    expect(decision.kind).toBe('hit');
    expect(decision.kind === 'hit' && decision.path).toBe(`${fixture.clients}/nordwind.at`);
  });

  it('reads a host as a name only when the literal word matches nothing', () => {
    const decision = run('orbit.com website');
    expect(decision.kind).toBe('hit');
    expect(decision.kind === 'hit' && decision.path).toBe(`${fixture.clients}/orbit-website`);
  });

  it('offers a picker when two different places match', () => {
    const decision = run('tabletop');
    expect(decision.kind).toBe('choose');
    const paths = decision.kind === 'choose' ? decision.candidates.map((c) => c.candidate.name) : [];
    expect(paths.sort()).toEqual(['tabletop-3d', 'tabletop-web']);
  });

  it('resolves "latest <name> folder" to the newest child', () => {
    const decision = run('latest petalworks folder');
    expect(decision.kind === 'hit' && decision.path).toBe(`${fixture.clients}/petalworks/petalworks-2026`);
  });

  it('finds the year folder even when a same named folder without children ranks first', () => {
    mkdirSync(join(fixture.projects, 'petalworks'), { recursive: true });
    const withRival: ResolveInput = { ...input, index: buildIndex(loadConfig()) };
    const decision = resolveQuery(tokenize('latest petalworks folder'), withRival);
    expect(decision.kind === 'hit' && decision.path).toBe(`${fixture.clients}/petalworks/petalworks-2026`);
  });

  it('keeps "latest" stable when the year folder itself is highly frecent', () => {
    const yearFolder = `${fixture.clients}/petalworks/petalworks-2026`;
    const decision = tokenizeThen(
      'latest petalworks folder',
      withDb({ ...emptyDb(), records: [{ path: yearFolder, visits: 80, lastVisit: NOW_SECONDS }] }),
    );
    expect(decision.kind === 'hit' && decision.path).toBe(yearFolder);
  });

  it('dives one level deeper when "latest" targets the year folder by name', () => {
    const decision = run('latest petalworks-2026');
    expect(decision.kind === 'hit' && decision.path).toBe(
      `${fixture.clients}/petalworks/petalworks-2026/06-workshop`,
    );
  });

  it('resolves "oldest <name>" to the oldest child', () => {
    const decision = run('oldest petalworks');
    expect(decision.kind === 'hit' && decision.path).toBe(`${fixture.clients}/petalworks/petalworks-2024`);
  });

  it('uses a year token as a hard filter', () => {
    const decision = run('petalworks 2025');
    expect(decision.kind === 'hit' && decision.path).toBe(`${fixture.clients}/petalworks/petalworks-2025`);
  });

  it('respects "in <root>"', () => {
    const decision = run('squash in dev');
    expect(decision.kind === 'hit' && decision.path).toBe(`${fixture.projects}/squash`);
  });

  it('falls through to the AI tier when nothing looks right', () => {
    const decision = run('that client with the flowers');
    expect(decision.kind).toBe('unsure');
  });

  it('lets frecency break a tie the index cannot', () => {
    const hot = `${fixture.projects}/tabletop-web`;
    const decision = run(
      'tabletop',
      withDb({ ...emptyDb(), records: [{ path: hot, visits: 40, lastVisit: NOW_SECONDS }] }),
    );
    expect(decision.kind === 'hit' && decision.path).toBe(hot);
  });

  it('never lets frecency promote a prefix above an exact name', () => {
    const exact = join(fixture.projects, 'alpha');
    const prefix = join(fixture.clients, 'alphabet');
    mkdirSync(exact);
    mkdirSync(prefix);
    const indexed = { ...input, index: buildIndex(loadConfig()) };
    const decision = tokenizeThen('alpha', {
      ...indexed,
      db: { ...emptyDb(), records: [{ path: prefix, visits: 1000, lastVisit: NOW_SECONDS }] },
    });
    expect(decision.kind === 'hit' && decision.path).toBe(exact);
  });

  it('finds a remembered path that is outside every root', () => {
    const outside = join(fixture.rootDir, 'elsewhere', 'gadgetron');
    mkdirSync(outside, { recursive: true });
    const decision = run(
      'gadgetron',
      withDb({ ...emptyDb(), records: [{ path: outside, visits: 3, lastVisit: NOW_SECONDS }] }),
    );
    expect(decision.kind === 'hit' && decision.path).toBe(outside);
  });

  /** A folder merged into another as a subfolder: the old sibling is gone but still remembered. */
  it('jumps to the surviving subfolder instead of offering the deleted sibling', () => {
    const deleted = join(fixture.projects, 'squash-src');
    const decision = run(
      'squash src',
      withDb({ ...emptyDb(), records: [{ path: deleted, visits: 500, lastVisit: NOW_SECONDS }] }),
    );
    expect(decision.kind).toBe('hit');
    expect(decision.kind === 'hit' && decision.path).toBe(`${fixture.projects}/squash/src`);
  });

  it('finds directories with spaces and unicode', () => {
    expect(run('space dir with spaces').kind).toBe('hit');
    expect(run('ünicöde').kind).toBe('hit');
  });
});

describe('buildCandidates', () => {
  it('keeps a remembered directory that still exists outside every root', () => {
    const outside = join(fixture.rootDir, 'elsewhere', 'gadgetron');
    mkdirSync(outside, { recursive: true });
    const paths = buildCandidates(
      withDb({ ...emptyDb(), records: [{ path: outside, visits: 3, lastVisit: NOW_SECONDS }] }),
    ).map((c) => c.path);
    expect(paths).toContain(outside);
  });

  it('drops a remembered directory that no longer exists', () => {
    const deleted = join(fixture.rootDir, 'elsewhere', 'vanished');
    const paths = buildCandidates(
      withDb({ ...emptyDb(), records: [{ path: deleted, visits: 3, lastVisit: NOW_SECONDS }] }),
    ).map((c) => c.path);
    expect(paths).not.toContain(deleted);
  });

  it('drops a remembered path that is now a file', () => {
    const file = join(fixture.projects, 'squash', 'readme.md');
    const paths = buildCandidates(
      withDb({ ...emptyDb(), records: [{ path: file, visits: 3, lastVisit: NOW_SECONDS }] }),
    ).map((c) => c.path);
    expect(paths).not.toContain(file);
  });
});

describe('looseCandidates', () => {
  it('surfaces a directory whose name is contained in the query', () => {
    const guesses = looseCandidates(tokenize('squashy'), input);
    expect(guesses[0]?.candidate.path).toBe(`${fixture.projects}/squash`);
  });

  it('gives the AI something to look at when the strict tier found nothing', () => {
    expect(resolveQuery(tokenize('squashy'), input).kind).toBe('unsure');
    expect(looseCandidates(tokenize('squashy'), input).length).toBeGreaterThan(0);
  });
});

const scored = (path: string, score: number): ScoredCandidate => ({
  candidate: { path, name: path.slice(path.lastIndexOf('/') + 1), mtime: 0, root: '' },
  score,
});

describe('decide', () => {
  it('needs both the hit score and the gap', () => {
    expect(decide([scored('/a', THRESHOLD.hit), scored('/b', THRESHOLD.hit - THRESHOLD.gap)]).kind).toBe('hit');
    expect(decide([scored('/a', THRESHOLD.hit), scored('/b', THRESHOLD.candidate)]).kind).toBe('choose');
    expect(decide([scored('/a', THRESHOLD.hit - 1)]).kind).toBe('unsure');
  });

  it('does not ask about a runner up that is not worth showing', () => {
    const noise = THRESHOLD.candidate - 1;
    expect(decide([scored('/a', THRESHOLD.hit), scored('/b', noise)]).kind).toBe('hit');
  });

  it('reports nothing at all as unsure', () => {
    expect(decide([])).toEqual({ kind: 'unsure', candidates: [] });
  });
});

describe('collapseChains', () => {
  it('keeps the better scoring member of an ancestor chain', () => {
    const kept = collapseChains([scored('/a/b', 900), scored('/a/b/c', 800), scored('/z', 700)]);
    expect(kept.map((k) => k.candidate.path)).toEqual(['/a/b', '/z']);
  });
});
