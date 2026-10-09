import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildBundle, runCliIn } from './cli.js';
import { addWorkshopTree, makeFixture, writeConfig, type Fixture } from './fixtures.js';

let fixture: Fixture;
const cli = (...args: string[]) => runCliIn(fixture, args);

beforeAll(() => {
  expect(buildBundle()).toBe(0);
});

beforeEach(() => {
  fixture = makeFixture();
  addWorkshopTree(fixture);
  writeConfig(fixture);
  expect(cli('index', '--refresh').status).toBe(0);
});

afterEach(() => {
  fixture.cleanup();
});

describe('a taught alias', () => {
  it('wins over a confident matcher answer for its own words', () => {
    const october = join(fixture.clients, 'mobile-first-workshops', 'mobile-first-october-2026');
    const before = cli('query', '--', 'mobile', 'first', 'workshop');
    expect(before.status).toBe(0);
    expect(before.stdout.trim()).not.toBe(october);
    expect(cli('alias', 'add', october, '--', 'mobile', 'first', 'workshop').status).toBe(0);
    expect(cli('alias', 'add', october, '--', 'mobile', 'first').status).toBe(0);
    expect(cli('query', '--', 'mobile', 'first', 'workshop').stdout.trim()).toBe(october);
    expect(cli('query', '--', 'mobile', 'first').stdout.trim()).toBe(october);
    expect(cli('query', '--', 'go', 'to', 'the', 'mobile', 'first', 'workshop', 'folder').stdout.trim())
      .toBe(october);
  });

  it('keeps its order word, so it never answers a different ordered question', () => {
    const october = join(fixture.clients, 'mobile-first-workshops', 'mobile-first-october-2026');
    expect(cli('alias', 'add', october, '--', 'mobile', 'first').status).toBe(0);
    expect(cli('query', '--', 'oldest', 'mobile', 'workshop').stdout.trim()).not.toBe(october);
    expect(cli('query', '--', 'petalworks').stdout.trim()).toBe(join(fixture.clients, 'petalworks'));
  });
});
