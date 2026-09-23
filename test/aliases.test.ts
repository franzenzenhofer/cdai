import { readFileSync, writeFileSync } from 'node:fs';
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
  it('still reads aliases written before the store was shared', () => {
    // v0.3.x wrote `path` where the shared store now writes `value`. These are a person's own
    // remembered intents; they are converted in place, not dropped for the wrong shape.
    const file = join(fixture.dataDir, 'aliases.json');
    writeFileSync(file, JSON.stringify({
      version: 1,
      aliases: [{ query: 'that client', path: fixture.clients, updatedAt: 7 }],
    }));
    expect(findAlias('that client')).toEqual({
      query: 'that client', path: fixture.clients, updatedAt: 7,
    });
    const rewritten = JSON.parse(readFileSync(file, 'utf8')) as { aliases: { value: string }[] };
    expect(rewritten.aliases[0]?.value).toBe(fixture.clients);
  });

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

  it('never overwrites a future alias schema', () => {
    const file = join(fixture.dataDir, 'aliases.json');
    const future = JSON.stringify({ version: 999, aliases: [] });
    writeFileSync(file, future);
    expect(() => loadAliases()).toThrow('unsupported alias schema');
    expect(() => rememberAlias('new intent', fixture.clients, 1)).toThrow('unsupported alias schema');
    expect(readFileSync(file, 'utf8')).toBe(future);
  });
});
