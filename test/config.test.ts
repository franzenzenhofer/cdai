import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_DEPTH, loadConfig } from '../src/config.js';
import { makeFixture, type Fixture } from './fixtures.js';

let fixture: Fixture;

beforeEach(() => {
  fixture = makeFixture();
  process.env['CDAI_CONFIG_DIR'] = fixture.configDir;
});

afterEach(() => {
  fixture.cleanup();
  delete process.env['CDAI_CONFIG_DIR'];
});

const writeRawConfig = (value: unknown): void => {
  writeFileSync(join(fixture.configDir, 'config.json'), JSON.stringify(value));
};

describe('loadConfig', () => {
  it('ignores blank roots, deduplicates paths, and bounds crawl depth', () => {
    writeRawConfig({
      roots: [
        ' ',
        { path: fixture.projects, depth: 2 },
        { path: fixture.projects, depth: 3.9 },
        { path: fixture.clients, depth: 1e100 },
      ],
    });
    expect(loadConfig().roots).toEqual([
      { path: fixture.projects, depth: 3 },
      { path: fixture.clients, depth: MAX_DEPTH },
    ]);
  });

  it('reports malformed user configuration instead of silently replacing it', () => {
    writeFileSync(join(fixture.configDir, 'config.json'), '{partial');
    expect(() => loadConfig()).toThrow();
  });
});
