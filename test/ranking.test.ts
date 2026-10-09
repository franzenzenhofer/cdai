import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { resolveQuery, type Decision, type ResolveInput } from '../src/match/resolve.js';
import { tokenize } from '../src/match/tokenize.js';
import { emptyDb } from '../src/store/db.js';
import { buildIndex } from '@franzenzenhofer/intent-core/store/indexer';
import { addWorkshopTree, makeFixture, writeConfig, type Fixture } from './fixtures.js';

let fixture: Fixture;
let input: ResolveInput;
const NOW_SECONDS = Math.floor(Date.now() / 1000);

beforeEach(() => {
  fixture = makeFixture();
  addWorkshopTree(fixture);
  process.env['CDAI_CONFIG_DIR'] = fixture.configDir;
  process.env['CDAI_DATA_DIR'] = fixture.dataDir;
  writeConfig(fixture);
  const config = loadConfig();
  input = { index: buildIndex(config), db: emptyDb(), cwd: fixture.rootDir, nowSeconds: NOW_SECONDS, roots: config.roots };
});

afterEach(() => {
  fixture.cleanup();
  delete process.env['CDAI_CONFIG_DIR'];
  delete process.env['CDAI_DATA_DIR'];
});

const run = (query: string, over: ResolveInput = input): Decision => resolveQuery(tokenize(query), over);
const workshops = (): string => join(fixture.clients, 'mobile-first-workshops');
const hitPath = (decision: Decision): string | false => decision.kind === 'hit' && decision.path;

describe('an order word that is also part of a name', () => {
  it('names the folder carrying every word, never a leaf of an older workshop', () => {
    expect(hitPath(run('mobile first workshop'))).toBe(workshops());
    expect(hitPath(run('mobile first'))).toBe(workshops());
  });

  it('is not outvoted by the frecency of the older workshop', () => {
    const older = join(fixture.clients, 'mobile-workshop-2024');
    const db = { ...emptyDb(), records: [{ path: older, visits: 80, lastVisit: NOW_SECONDS }] };
    expect(hitPath(run('mobile first workshop', { ...input, db }))).toBe(workshops());
  });

  it('still orders when the word is meant as an operator', () => {
    expect(hitPath(run('latest mobile first workshop'))).toBe(join(workshops(), 'mobile-first-october-2026'));
    expect(hitPath(run('oldest petalworks'))).toBe(join(fixture.clients, 'petalworks', 'petalworks-2024'));
    expect(hitPath(run('first petalworks'))).toBe(join(fixture.clients, 'petalworks', 'petalworks-2024'));
  });
});

describe('equally matching siblings', () => {
  it('rank the most recently modified first, ahead of a shorter older name', () => {
    const decision = run('mobile first 20');
    expect(decision.kind).toBe('choose');
    const names = decision.kind === 'choose' ? decision.candidates.map((c) => c.candidate.name) : [];
    expect(names.slice(0, 2)).toEqual(['mobile-first-october-2026', 'mobile-first-2025']);
  });
});
