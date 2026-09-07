import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeFixture, type Fixture } from './fixtures.js';
import packageJson from '../package.json' with { type: 'json' };

const REPO = process.cwd();

/** npm 11 reports the packed tarballs as an array, npm 12 as an object keyed by package name. */
const packedFilename = (stdout: string): string => {
  const parsed = JSON.parse(stdout) as unknown;
  const packed = (Array.isArray(parsed) ? parsed : Object.values(parsed as object)) as unknown[];
  const first = packed[0];
  const filename = typeof first === 'object' && first !== null && 'filename' in first
    ? (first as { filename: unknown }).filename
    : undefined;
  expect(typeof filename).toBe('string');
  return filename as string;
};
let fixture: Fixture;
let archive = '';
let installedBin = '';

beforeAll(() => {
  fixture = makeFixture();
  const build = spawnSync('node', [join(REPO, 'scripts', 'build.mjs')], { encoding: 'utf8' });
  expect(build.status).toBe(0);
  const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', fixture.rootDir], {
    cwd: REPO,
    encoding: 'utf8',
  });
  expect(packed.status).toBe(0);
  archive = join(fixture.rootDir, packedFilename(packed.stdout));
  const prefix = join(fixture.rootDir, 'installed');
  mkdirSync(prefix);
  const installed = spawnSync(
    'npm',
    ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', archive],
    { encoding: 'utf8' },
  );
  expect(installed.status).toBe(0);
  installedBin = join(prefix, 'node_modules', 'cdai', 'dist', 'cdai.js');
});

afterAll(() => fixture.cleanup());

describe('packed installation', () => {
  it('runs the shipped bundle and reports the release version', () => {
    const version = spawnSync('node', [installedBin, '--version'], { encoding: 'utf8' });
    expect(version.status).toBe(0);
    expect(version.stdout).toBe('');
    expect(version.stderr.trim()).toBe(packageJson.version);
  });

  it('ships only the declared runtime surface', () => {
    const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
    expect(listing.status).toBe(0);
    expect(listing.stdout).toContain('package/dist/cdai.js');
    expect(listing.stdout).toContain('package/README.md');
    expect(listing.stdout).not.toContain('package/src/');
    expect(listing.stdout).not.toContain('package/test/');
  });
});
