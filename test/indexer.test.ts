import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  buildIndex,
  childrenOf,
  emptyIndex,
  isStale,
  loadIndex,
  matchesConfig,
  refreshIndex,
} from '../src/store/indexer.js';
import { makeFixture, writeConfig, type Fixture } from './fixtures.js';

let fixture: Fixture;

beforeEach(() => {
  fixture = makeFixture();
  process.env['CDAI_CONFIG_DIR'] = fixture.configDir;
  process.env['CDAI_DATA_DIR'] = fixture.dataDir;
  writeConfig(fixture);
});

afterEach(() => {
  fixture.cleanup();
  delete process.env['CDAI_CONFIG_DIR'];
  delete process.env['CDAI_DATA_DIR'];
});

const names = (): string[] => buildIndex(loadConfig()).entries.map((entry) => entry.name);

describe('buildIndex', () => {
  it('walks real directories in both roots', () => {
    const found = names();
    expect(found).toContain('squash');
    expect(found).toContain('petalworks');
    expect(found).toContain('petalworks-2026');
  });

  it('keeps directories with spaces and unicode', () => {
    const found = names();
    expect(found).toContain('space dir with spaces');
    expect(found).toContain('ünicöde-projekt');
  });

  it('skips ignored and hidden directories', () => {
    const found = names();
    expect(found).not.toContain('node_modules');
    expect(found).not.toContain('left-pad');
    expect(found).not.toContain('.hidden-thing');
  });

  it('records only directories, never files', () => {
    expect(names()).not.toContain('readme.md');
  });

  it('ignores a symlink that points at a file', () => {
    expect(names()).not.toContain('AGENTS.md');
  });

  it('does not index a symlink target twice', () => {
    const entries = buildIndex(loadConfig()).entries.filter((e) => e.path.includes('squash'));
    const realPaths = new Set(entries.map((e) => e.path));
    expect(realPaths.size).toBe(entries.length);
    expect(entries.filter((e) => e.name === 'src')).toHaveLength(1);
  });

  it('survives an unreadable directory', () => {
    const found = names();
    expect(found).toContain('locked');
    expect(found).not.toContain('inside');
  });

  it('honours the per root depth limit', () => {
    const names = buildIndex(loadConfig()).entries.map((e) => e.path.split('/').pop());
    expect(names).toContain('06-workshop');
    expect(names).not.toContain('slides');
  });

  it('uses wall time for the crawl deadline, independent of the stored timestamp', () => {
    const index = buildIndex(loadConfig(), 1);
    expect(index.generatedAt).toBe(1);
    expect(index.entries.length).toBeGreaterThan(0);
  });
});

describe('index persistence', () => {
  it('round trips through disk', () => {
    const written = refreshIndex(loadConfig());
    const read = loadIndex();
    expect(read.entries).toHaveLength(written.entries.length);
    expect(read.generatedAt).toBe(written.generatedAt);
  });

  it('treats a missing index as empty and stale', () => {
    expect(loadIndex().entries).toEqual([]);
    expect(isStale(emptyIndex(), Date.now())).toBe(true);
  });

  it('is fresh right after a refresh', () => {
    expect(isStale(refreshIndex(loadConfig()), Date.now())).toBe(false);
  });

  it('invalidates an index when roots, depth, or ignore configuration changes', () => {
    const config = loadConfig();
    const index = refreshIndex(config);
    expect(matchesConfig(index, config)).toBe(true);
    expect(matchesConfig(index, { ...config, ignore: [...config.ignore, 'tmp'] })).toBe(false);
    expect(matchesConfig(index, { ...config, roots: [{ ...config.roots[0]!, depth: 9 }] })).toBe(false);
  });

  it('loads an older unsigned index as rebuildable but configuration-mismatched', () => {
    const config = loadConfig();
    writeFileSync(
      join(fixture.dataDir, 'index.json'),
      JSON.stringify({ version: 1, generatedAt: Date.now(), entries: [] }),
    );
    expect(matchesConfig(loadIndex(), config)).toBe(false);
  });

  it('treats a future cache timestamp as stale after clock skew', () => {
    expect(isStale({ ...emptyIndex(), generatedAt: Date.now() + 1 }, Date.now())).toBe(true);
  });

  it('treats malformed JSON as an empty rebuildable cache', () => {
    writeFileSync(join(fixture.dataDir, 'index.json'), '{partial');
    expect(loadIndex()).toEqual(emptyIndex());
  });
});

describe('childrenOf', () => {
  it('returns only the direct children present in the index', () => {
    const index = buildIndex(loadConfig());
    const children = childrenOf(index, `${fixture.clients}/petalworks`);
    expect(children.map((c) => c.name).sort()).toEqual([
      'petalworks-2024',
      'petalworks-2025',
      'petalworks-2026',
    ]);
  });

  it('carries usable mtimes so latest can sort', () => {
    const index = buildIndex(loadConfig());
    const children = childrenOf(index, `${fixture.clients}/petalworks`);
    const newest = [...children].sort((a, b) => b.mtime - a.mtime)[0];
    expect(newest?.name).toBe('petalworks-2026');
  });
});
