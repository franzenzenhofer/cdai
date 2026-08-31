import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findAlias,
  forgetAlias,
  loadAliases,
  MAX_ALIASES,
  normalizeIntent,
  rememberAlias,
} from '../src/store/aliases.js';
import { makeFixture, type Fixture } from './fixtures.js';

let fixture: Fixture;

beforeEach(() => {
  fixture = makeFixture();
  process.env['CDAI_DATA_DIR'] = fixture.dataDir;
});

afterEach(() => {
  fixture.cleanup();
  delete process.env['CDAI_DATA_DIR'];
});

describe('confirmed intent aliases', () => {
  it('normalizes, replaces, and forgets exact intent locally', () => {
    expect(normalizeIntent('  That   CLIENT With Flowers ')).toBe('that client with flowers');
    rememberAlias('That CLIENT with flowers', fixture.clients, 1);
    rememberAlias(' that client WITH flowers ', fixture.projects, 2);
    expect(findAlias('THAT client with flowers')).toEqual({
      query: 'that client with flowers',
      path: fixture.projects,
      updatedAt: 2,
    });
    forgetAlias('that client with flowers');
    expect(findAlias('that client with flowers')).toBeUndefined();
  });

  it('bounds storage and recovers from malformed data', () => {
    for (let i = 0; i < MAX_ALIASES + 5; i += 1) rememberAlias(`intent ${i}`, fixture.clients, i);
    expect(loadAliases().aliases).toHaveLength(MAX_ALIASES);
    writeFileSync(join(fixture.dataDir, 'aliases.json'), '{partial');
    expect(loadAliases().aliases).toEqual([]);
  });

  it('ignores unsafe records and non-absolute target paths', () => {
    writeFileSync(
      join(fixture.dataDir, 'aliases.json'),
      JSON.stringify({ version: 1, aliases: [{ query: 'safe', path: 'relative', updatedAt: 1 }] }),
    );
    expect(loadAliases().aliases).toEqual([]);
    rememberAlias('unsafe', 'relative', 1);
    expect(findAlias('unsafe')).toBeUndefined();
  });
});
