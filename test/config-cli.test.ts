import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildBundle, runCliIn } from './cli.js';
import { fixtureConfig, makeFixture, type Fixture } from './fixtures.js';

let fixture: Fixture;
const cli = (...args: string[]) => runCliIn(fixture, args);
const configPath = (): string => join(fixture.configDir, 'config.json');

const writeConfigWith = (extra: Record<string, unknown>): void => {
  const base = JSON.parse(fixtureConfig(fixture)) as Record<string, unknown>;
  writeFileSync(configPath(), JSON.stringify({ ...base, ...extra }));
};

beforeAll(() => {
  expect(buildBundle()).toBe(0);
});

beforeEach(() => {
  fixture = makeFixture();
});

afterEach(() => {
  fixture.cleanup();
});

describe('aliases declared in config.json', () => {
  it('win over the matcher and over a taught alias for the same words', () => {
    const declared = join(fixture.clients, 'acme-shop');
    const taught = join(fixture.clients, 'orbit');
    writeConfigWith({ aliases: { 'the shop': declared, petalworks: '~/clients/orbit-website' } });
    expect(cli('alias', 'add', taught, '--', 'the', 'shop').status).toBe(0);
    expect(cli('query', '--', 'the', 'shop').stdout.trim()).toBe(declared);
    expect(cli('query', '--', 'go', 'to', 'the', 'shop', 'folder').stdout.trim()).toBe(declared);
    expect(cli('query', '--', 'petalworks').stdout.trim()).toBe(join(fixture.clients, 'orbit-website'));
    const listed = cli('alias', 'list').stderr;
    expect(listed).toContain('the shop -> ~/clients/acme-shop (config)');
    expect(listed).toContain('the shop -> ~/clients/orbit\n');
  });

  it('fail loud when they point nowhere, and cannot be forgotten from the CLI', () => {
    writeConfigWith({ aliases: { ghost: join(fixture.clients, 'ghost') } });
    const run = cli('query', '--', 'ghost');
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('config alias "ghost" points to a missing directory');
    expect(run.stderr).toContain(configPath());
    const forget = cli('alias', 'forget', '--', 'ghost');
    expect(forget.status).toBe(1);
    expect(forget.stderr).toContain('declared in');
  });

  it('survive setup rewriting the file', () => {
    writeConfigWith({ aliases: { 'the shop': join(fixture.clients, 'acme-shop') } });
    expect(cli('setup', '--no-ai').status).toBe(0);
    expect(JSON.parse(readFileSync(configPath(), 'utf8'))).toMatchObject({
      aliases: { 'the shop': join(fixture.clients, 'acme-shop') },
    });
  });
});

describe('cdai config', () => {
  it('prints the effective config on stdout and where it lives on stderr', () => {
    writeConfigWith({ aliases: { 'the shop': '~/clients/acme-shop' } });
    const run = cli('config');
    expect(run.status).toBe(0);
    const shown = JSON.parse(run.stdout) as { roots: unknown[]; aliases: Record<string, string> };
    expect(shown.roots).toHaveLength(2);
    expect(shown.aliases['the shop']).toBe(join(fixture.clients, 'acme-shop'));
    expect(run.stderr).toContain('~/config/config.json (valid)');
    expect(run.stderr).toContain('cdai setup --root <path>');
    expect(cli('config', 'path').stdout).toBe(`${configPath()}\n`);
    expect(cli('config', 'bogus').status).toBe(1);
  });

  it('shows the defaults before setup ran, and names the bad key when it is broken', () => {
    expect(cli('config').stderr).toContain('not written yet, showing defaults');
    writeConfigWith({ roots: [{ path: fixture.projects, depth: 0 }] });
    const run = cli('config');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('roots[0].depth must be an integer from 1 to 64');
  });
});

describe('root weight', () => {
  it('decides between equally named folders in different roots', () => {
    mkdirSync(join(fixture.projects, 'orbit'));
    writeConfigWith({});
    expect(cli('query', '--', 'orbit').status).toBe(3);
    expect(cli('setup', '--root', fixture.clients, '--depth', '3', '--weight', '250', '--yes').status).toBe(0);
    expect(cli('query', '--', 'orbit').stdout.trim()).toBe(join(fixture.clients, 'orbit'));
    expect(cli('setup', '--root', fixture.clients, '--depth', '3', '--yes').status).toBe(0);
    expect(JSON.parse(readFileSync(configPath(), 'utf8'))).toMatchObject({
      roots: [{ path: fixture.projects }, { path: fixture.clients, weight: 250 }],
    });
    expect(cli('setup', '--weight', '5').stderr).toContain('--weight requires --root');
    expect(cli('setup', '--root', fixture.clients, '--weight', 'x').stderr).toContain('--weight must be an integer');
  });
});
