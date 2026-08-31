import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UNREADABLE_MODE = 0o000;
const READABLE_MODE = 0o755;

export interface Fixture {
  readonly rootDir: string;
  readonly projects: string;
  readonly clients: string;
  readonly configDir: string;
  readonly dataDir: string;
  readonly unreadable: string;
  cleanup(): void;
}

const mkdirs = (base: string, relatives: readonly string[]): void => {
  for (const relative of relatives) mkdirSync(join(base, relative), { recursive: true });
};

export const PROJECT_DIRS = [
  'squash',
  'squash/src',
  'scripts',
  'tabletop-3d',
  'tabletop-web',
  'zenith',
  'zenith/node_modules/left-pad',
  'almanac',
  'goalmap',
  'spring',
  'string',
  '.hidden-thing',
  'space dir with spaces',
  'ünicöde-projekt',
];

export const CLIENT_DIRS = [
  'petalworks',
  'petalworks/petalworks-2024',
  'petalworks/petalworks-2025',
  'petalworks/petalworks-2026',
  'petalworks/petalworks-2026/06-workshop',
  'petalworks/petalworks-2026/06-workshop/slides',
  'acme-shop',
  'acme-shop/acme-shop-2025',
  'orbit',
];

/** Real directories on disk, no mock filesystem anywhere in this suite. */
export const makeFixture = (): Fixture => {
  const rootDir = mkdtempSync(join(tmpdir(), 'cdai-test-'));
  const projects = join(rootDir, 'dev');
  const clients = join(rootDir, 'clients');
  const configDir = join(rootDir, 'config');
  const dataDir = join(rootDir, 'data');
  mkdirs(projects, PROJECT_DIRS);
  mkdirs(clients, CLIENT_DIRS);
  mkdirSync(configDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  symlinkSync(join(projects, 'squash'), join(projects, 'squash-link'));
  writeFileSync(join(projects, 'squash', 'readme.md'), 'not a directory\n');
  symlinkSync(join(projects, 'squash', 'readme.md'), join(projects, 'AGENTS.md'));
  const unreadable = join(projects, 'locked');
  mkdirSync(unreadable);
  mkdirSync(join(unreadable, 'inside'));
  chmodSync(unreadable, UNREADABLE_MODE);
  ageDirs(clients);
  return {
    rootDir,
    projects,
    clients,
    configDir,
    dataDir,
    unreadable,
    cleanup(): void {
      chmodSync(unreadable, READABLE_MODE);
      rmSync(rootDir, { recursive: true, force: true });
    },
  };
};

const YEAR_SECONDS = 365 * 24 * 3600;

/** Gives the year folders distinct mtimes so "latest" has something deterministic to pick. */
const ageDirs = (clients: string): void => {
  const now = Math.floor(Date.now() / 1000);
  const ages: ReadonlyArray<readonly [string, number]> = [
    ['petalworks/petalworks-2024', 2 * YEAR_SECONDS],
    ['petalworks/petalworks-2025', YEAR_SECONDS],
    ['petalworks/petalworks-2026', 60],
  ];
  for (const [relative, age] of ages) {
    const stamp = now - age;
    utimesSync(join(clients, relative), stamp, stamp);
  }
};

export const fixtureConfig = (fixture: Fixture, ai: Record<string, unknown> = {}): string =>
  JSON.stringify({
    roots: [
      { path: fixture.projects, depth: 2 },
      { path: fixture.clients, depth: 3 },
    ],
    ignore: ['node_modules', '.git', 'dist'],
    ai: { enabled: false, command: 'claude', model: 'sonnet', timeoutMs: 20000, ...ai },
  });

export const writeConfig = (fixture: Fixture, ai: Record<string, unknown> = {}): void => {
  writeFileSync(join(fixture.configDir, 'config.json'), fixtureConfig(fixture, ai));
};
