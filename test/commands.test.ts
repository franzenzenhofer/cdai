import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseZoxideList } from '../src/commands/import-zoxide.js';
import { CLOUD_DEPTH, DEV_DEPTH, HUB_MIN_CHILDREN, detectRoots } from '../src/commands/detect.js';
import { DEFAULT_AI, loadConfig } from '../src/config.js';
import { DAY_SECONDS } from '../src/store/frecency.js';
import { makeFixture, writeConfig, type Fixture } from './fixtures.js';
import packageJson from '../package.json' with { type: 'json' };

const REPO = process.cwd();
const BIN = join(REPO, 'dist', 'cdai.js');
const NOW = 1_800_000_000;

let fixture: Fixture;

const runCli = (...args: string[]): { status: number; stdout: string; stderr: string } => {
  const result = spawnSync('node', [BIN, ...args], {
    encoding: 'utf8',
    cwd: fixture.rootDir,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: fixture.rootDir,
      CDAI_CONFIG_DIR: fixture.configDir,
      CDAI_DATA_DIR: fixture.dataDir,
    },
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
};

const runCliWithTty = (input: string, ...args: string[]) => {
  const python = [
    'import os, pty, sys',
    'status = pty.spawn(sys.argv[1:])',
    'raise SystemExit(os.waitstatus_to_exitcode(status))',
  ].join('; ');
  const result = spawnSync('python3', ['-c', python, 'node', BIN, ...args], {
    input,
    encoding: 'utf8',
    cwd: fixture.rootDir,
    env: {
      ...process.env,
      HOME: fixture.rootDir,
      CDAI_CONFIG_DIR: fixture.configDir,
      CDAI_DATA_DIR: fixture.dataDir,
    },
  });
  return { status: result.status ?? -1, output: result.stdout };
};

beforeAll(() => {
  expect(spawnSync('node', [join(REPO, 'scripts', 'build.mjs')], { encoding: 'utf8' }).status).toBe(0);
});

beforeEach(() => {
  fixture = makeFixture();
});

afterEach(() => {
  fixture.cleanup();
});

describe('parseZoxideList', () => {
  it('reads the score and path columns', () => {
    const records = parseZoxideList('  12.5 /a/b\n   1 /c d\nbroken line\n', NOW);
    expect(records).toEqual([
      { path: '/a/b', visits: 13, lastVisit: NOW - DAY_SECONDS },
      { path: '/c d', visits: 1, lastVisit: NOW - DAY_SECONDS },
    ]);
  });
});

describe('detectRoots', () => {
  it('proposes a dev directory at depth 2 and the busiest cloud folder at depth 3', () => {
    const home = fixture.rootDir;
    mkdirSync(join(home, 'dev'), { recursive: true });
    const hub = join(home, 'Acme Dropbox', 'office', 'freelance', 'clients');
    for (let i = 0; i < HUB_MIN_CHILDREN; i += 1) mkdirSync(join(hub, `client-${i}`), { recursive: true });
    const roots = detectRoots(home);
    expect(roots).toContainEqual({ path: join(home, 'dev'), depth: DEV_DEPTH });
    expect(roots).toContainEqual({ path: hub, depth: CLOUD_DEPTH });
  });
});

describe('cli surface', () => {
  it('runs setup non interactively and writes a config', () => {
    mkdirSync(join(fixture.rootDir, 'dev'), { recursive: true });
    const run = runCli('setup', '--yes', '--no-ai');
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('eval "$(cdai init zsh)"');
    const written: unknown = JSON.parse(readFileSync(join(fixture.configDir, 'config.json'), 'utf8'));
    expect(JSON.stringify(written)).toContain(join(fixture.rootDir, 'dev'));
    expect(loadConfigFrom(fixture).ai.command).toBe('auto');
    expect(loadConfigFrom(fixture).ai.enabled).toBe(false);
    expect(run.stderr).not.toContain('candidate directory paths may be sent');
  });

  it('offers explicit AI opt-in and opt-out during setup', () => {
    const disabled = runCli('setup', '--yes', '--no-ai');
    expect(disabled.status).toBe(0);
    expect(loadConfigFrom(fixture).ai.enabled).toBe(false);
    expect(disabled.stderr).toContain('AI fallback disabled');
    expect(runCli('setup', '--ai', '--no-ai').status).toBe(1);
    expect(runCli('setup', '--ai').status).toBe(0);
    expect(loadConfigFrom(fixture).ai.enabled).toBe(true);
  });

  it('requires explicit headless consent and supports custom roots', () => {
    expect(runCli('setup', '--yes').status).toBe(1);
    expect(existsSync(join(fixture.configDir, 'config.json'))).toBe(false);
    const run = runCli(
      'setup', '--root', fixture.clients, '--depth', '4', '--yes', '--no-ai',
    );
    expect(run.status).toBe(0);
    expect(loadConfigFrom(fixture).roots).toContainEqual({ path: fixture.clients, depth: 4 });
    const manual = join(fixture.rootDir, 'manual-root');
    mkdirSync(manual);
    expect(runCli('setup', '--root', manual, '--depth', '5', '--no-ai').status).toBe(1);
    expect(loadConfigFrom(fixture).roots.some((root) => root.path === manual)).toBe(false);
    expect(runCli('setup', '--root', manual, '--depth', '5', '--yes', '--no-ai').status).toBe(0);
    expect(loadConfigFrom(fixture).roots).toContainEqual({ path: manual, depth: 5 });
    expect(runCli('setup', '--root', manual, '--depth', '6', '--yes', '--no-ai').status).toBe(0);
    expect(loadConfigFrom(fixture).roots).toContainEqual({ path: manual, depth: 6 });
    expect(runCli('setup', '--remove-root', manual, '--no-ai').status).toBe(0);
    expect(loadConfigFrom(fixture).roots.some((root) => root.path === manual)).toBe(false);
    expect(runCli('setup', '--remove-root', manual).status).toBe(1);
  });

  it('leaves no config behind when every interactive root is declined', () => {
    const run = runCliWithTty('n\n', 'setup');
    expect(run.status).toBe(3);
    expect(run.output).toContain('nothing was written');
    expect(existsSync(join(fixture.configDir, 'config.json'))).toBe(false);
  });

  it('does not rewrite an existing config when every proposed change is declined', () => {
    writeConfig(fixture);
    const manual = join(fixture.rootDir, 'declined-root');
    mkdirSync(manual);
    const file = join(fixture.configDir, 'config.json');
    const before = readFileSync(file, 'utf8');
    const run = runCliWithTty('n\n', 'setup', '--root', manual);
    expect(run.status).toBe(3);
    expect(run.output).toContain('nothing was written');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('rejects unknown management options and prints command help safely', () => {
    writeConfig(fixture);
    expect(runCli('setup', '--bogus').status).toBe(1);
    expect(runCli('setup', '--depth', '5').status).toBe(1);
    expect(runCli('index', '--bogus').status).toBe(1);
    expect(runCli('setup', '--help').status).toBe(0);
    expect(runCli('index', '--help').status).toBe(0);
    expect(runCli('query', '--help').status).toBe(0);
    expect(runCli('alias', 'forget', '--help').status).toBe(0);
    expect(runCli('alias', 'forget', '--bogus').status).toBe(1);
    expect(runCli('doctor', 'extra').status).toBe(1);
  });

  it('reports the machine state in doctor', () => {
    writeConfig(fixture);
    const run = runCli('doctor');
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('cdai doctor');
    expect(run.stderr).toContain('roots  2');
  });

  it('shows index statistics per root', () => {
    writeConfig(fixture);
    expect(runCli('index', '--refresh').stderr).toContain('directories in');
    expect(runCli('index').stderr).toContain('depth 3');
  });

  it('completes indexed directory names without human-facing output', () => {
    writeConfig(fixture);
    expect(runCli('index', '--refresh').status).toBe(0);
    const petal = runCli('complete', '--', 'pet');
    expect(petal).toEqual({ status: 0, stdout: 'petalworks\n', stderr: '' });
    expect(runCli('complete', '--', 'space').stdout).toBe('space dir with spaces\n');
    expect(runCli('complete', '--', '-P', 'pet').stdout).toBe('petalworks\n');
  });

  it('completes compact, typo, multi-word, ordered, year, and root intent', () => {
    writeConfig(fixture);
    expect(runCli('index', '--refresh').status).toBe(0);
    expect(runCli('complete', '--', 'gma').stdout).toBe('goalmap\n');
    expect(runCli('complete', '--', 'ptlw').stdout).toBe('petalworks\n');
    expect(runCli('complete', '--', 'petla').stdout).toBe('petalworks\n');
    expect(runCli('complete', '--', 'ttw').stdout).toBe('tabletop-web\n');
    expect(runCli('complete', '--', 'client', 'ptlw').stdout).toBe('petalworks\n');
    expect(runCli('complete', '--', 'latest', 'pet', 'folder').stdout).toBe('petalworks\n');
    expect(runCli('complete', '--', 'pet', '2025').stdout).toBe('petalworks-2025\n');
    expect(runCli('complete', '--', 'squash', 'in', 'de').stdout).toBe('dev\n');
  });

  it('keeps short, unrelated, and path-shaped completion non-destructive', () => {
    writeConfig(fixture);
    expect(runCli('index', '--refresh').status).toBe(0);
    const short = runCli('complete', '--', 'a').stdout.trim().split('\n');
    expect(short).toContain('almanac');
    expect(short).not.toContain('petalworks');
    expect(runCli('complete', '--', 'zzqx').stdout).toBe('');
    expect(runCli('complete', '--', 'srr').stdout).toBe('');
    expect(runCli('complete', '--', 'ring').stdout).toBe('');
    for (const path of ['./gma', '../gma', '/tmp/gma', '~/gma']) {
      expect(runCli('complete', '--', path).stdout).toBe('');
    }
  });

  it('keeps duplicate completion names safe for shell insertion', () => {
    mkdirSync(join(fixture.projects, 'shared'));
    mkdirSync(join(fixture.clients, 'shared'));
    mkdirSync(join(fixture.projects, 'doctor'));
    mkdirSync(join(fixture.clients, 'doctor'));
    writeConfig(fixture);
    expect(runCli('index', '--refresh').status).toBe(0);
    expect(runCli('complete', '--', 'sha').stdout).toBe('shared\n');
    expect(runCli('complete', '--', 'doc').stdout).toBe('');
  });

  it('keeps literal stopword and reserved directory names reachable', () => {
    const project = join(fixture.clients, 'project');
    const doctor = join(fixture.clients, 'doctor');
    mkdirSync(project);
    mkdirSync(doctor);
    for (const name of ['latest', 'oldest', '2025']) mkdirSync(join(fixture.clients, name));
    writeConfig(fixture);
    expect(runCli('index', '--refresh').status).toBe(0);
    expect(runCli('query', '--', 'project').stdout.trim()).toBe(project);
    expect(runCli('complete', '--', 'pro').stdout.trim()).toBe('project');
    expect(runCli('complete', '--', 'doc').stdout.trim()).toBe(doctor);
    for (const name of ['latest', 'oldest', '2025']) {
      expect(runCli('query', '--', name).stdout.trim()).toBe(join(fixture.clients, name));
      expect(runCli('complete', '--', name).stdout.trim()).toBe(name);
    }
  });

  it('keeps completion cached, rejects stale history, and invalidates changed config', () => {
    writeConfig(fixture);
    expect(runCli('index', '--refresh').status).toBe(0);
    writeFileSync(
      join(fixture.dataDir, 'db.json'),
      JSON.stringify({ version: 1, records: [{ path: join(fixture.clients, 'ghost'), visits: 100, lastVisit: NOW }] }),
    );
    expect(runCli('complete', '--', 'ghost').stdout).toBe('');
    const config: Record<string, unknown> = JSON.parse(
      readFileSync(join(fixture.configDir, 'config.json'), 'utf8'),
    ) as Record<string, unknown>;
    writeFileSync(
      join(fixture.configDir, 'config.json'),
      JSON.stringify({ ...config, ignore: ['node_modules', '.git', 'dist', 'changed'] }),
    );
    expect(runCli('complete', '--', 'pet').stdout).toBe('');
  });

  it('completes live remembered aliases even while the index needs rebuilding', () => {
    writeConfig(fixture);
    expect(runCli('index', '--refresh').status).toBe(0);
    writeFileSync(
      join(fixture.dataDir, 'aliases.json'),
      JSON.stringify({ version: 1, aliases: [{
        query: 'flowers client', path: join(fixture.clients, 'petalworks'), updatedAt: NOW,
      }] }),
    );
    const config = JSON.parse(readFileSync(join(fixture.configDir, 'config.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(fixture.configDir, 'config.json'), JSON.stringify({ ...config, ignore: ['changed'] }));
    expect(runCli('complete', '--', 'flo').stdout).toBe('flowers\n');
    expect(runCli('complete', '--', 'flowers', 'cl').stdout).toBe('client\n');
    expect(runCli('doctor').stderr).toContain('run `cdai index --refresh`');
  });

  it('does not merge multiple non-prefix remembered corrections', () => {
    writeConfig(fixture);
    expect(runCli('index', '--refresh').status).toBe(0);
    writeFileSync(
      join(fixture.dataDir, 'aliases.json'),
      JSON.stringify({ version: 1, aliases: [
        { query: 'src', path: join(fixture.projects, 'squash'), updatedAt: NOW },
        { query: 'scripts', path: join(fixture.projects, 'scripts'), updatedAt: NOW },
      ] }),
    );
    expect(runCli('complete', '--', 'srr').stdout).toBe('');
  });

  it('accepts a valid empty index without recrawling every query', () => {
    writeFileSync(
      join(fixture.configDir, 'config.json'),
      JSON.stringify({
        roots: [{ path: fixture.dataDir, depth: 1 }],
        ignore: [],
        ai: { enabled: false, command: 'auto', args: [], model: '', timeoutMs: 1000 },
      }),
    );
    expect(runCli('index', '--refresh').status).toBe(0);
    const before = readFileSync(join(fixture.dataDir, 'index.json'), 'utf8');
    expect(runCli('query', '--', 'missing').status).toBe(1);
    expect(readFileSync(join(fixture.dataDir, 'index.json'), 'utf8')).toBe(before);
  });

  it('emits Bash and fish completion hooks', () => {
    const bash = runCli('init', 'bash');
    const syntax = spawnSync('/bin/bash', ['-n'], { encoding: 'utf8', input: bash.stdout });
    expect(bash.status).toBe(0);
    expect(bash.stdout).toContain('complete -o filenames -F __cdai_complete cdai');
    expect(syntax.status).toBe(0);
    expect(runCli('init', 'fish').stdout).toContain("complete -c cdai -f -k -a '(__cdai_complete)'");
  });

  it('reports help and version as successful CLI commands', () => {
    expect(runCli('--help').status).toBe(0);
    const version = runCli('--version');
    expect(version.status).toBe(0);
    expect(version.stderr.trim()).toBe(packageJson.version);
  });

  it('lists and forgets confirmed aliases without editing JSON', () => {
    writeFileSync(
      join(fixture.dataDir, 'aliases.json'),
      JSON.stringify({
        version: 1,
        aliases: [{ query: 'flower client', path: join(fixture.clients, 'petalworks'), updatedAt: NOW }],
      }),
    );
    expect(runCli('alias', 'list').stderr).toContain('flower client');
    expect(runCli('alias', 'forget', '--', 'flower', 'client').status).toBe(0);
    expect(runCli('alias', 'list').stderr).toContain('no confirmed intent aliases');
  });

  it('writes and migrates private state permissions', () => {
    mkdirSync(join(fixture.rootDir, 'dev'), { recursive: true });
    expect(runCli('setup', '--yes', '--no-ai').status).toBe(0);
    const paths = [fixture.configDir, fixture.dataDir];
    paths.forEach((path) => expect(statSync(path).mode & 0o077).toBe(0));
    [join(fixture.configDir, 'config.json'), join(fixture.dataDir, 'index.json')]
      .forEach((path) => expect(statSync(path).mode & 0o077).toBe(0));
  });

  it('honours the config dir override', () => {
    writeConfig(fixture);
    process.env['CDAI_CONFIG_DIR'] = fixture.configDir;
    expect(loadConfig().roots).toHaveLength(2);
    delete process.env['CDAI_CONFIG_DIR'];
  });

  it('sanitizes invalid AI command, argument, and timeout values', () => {
    writeConfig(fixture, { command: ' ', args: ['--flag', 42], timeoutMs: 1.5 });
    const config = loadConfigFrom(fixture);
    expect(config.ai.command).toBe('auto');
    expect(config.ai.args).toEqual(['--flag']);
    expect(config.ai.timeoutMs).toBe(DEFAULT_AI.timeoutMs);
  });

  it('fails with usage when there is nothing to search for', () => {
    writeConfig(fixture);
    const run = runCli('query', '--');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('usage');
    expect(run.stdout).toBe('');
  });

  it('refuses to guess without configured roots', () => {
    const run = runCli('query', '--', 'petal');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('cdai setup');
  });

  it('never emits or even names a remembered directory that no longer exists', () => {
    writeConfig(fixture);
    const ghost = join(fixture.clients, 'ghost');
    writeFileSync(
      join(fixture.dataDir, 'db.json'),
      JSON.stringify({ version: 1, records: [{ path: ghost, visits: 100, lastVisit: NOW }] }),
    );
    const run = runCli('query', '--', 'ghost');
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('no match for "ghost"');
    expect(run.stderr).not.toContain(ghost);
  });

  it('refreshes once when a confident cached hit moved', () => {
    writeConfig(fixture);
    expect(runCli('index', '--refresh').status).toBe(0);
    const oldPath = join(fixture.clients, 'petalworks');
    const movedPath = join(fixture.projects, 'petalworks');
    renameSync(oldPath, movedPath);
    const run = runCli('query', '--', 'petalworks');
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(movedPath);
    expect(run.stderr).not.toContain('no longer exists');
  });

  it('does not accept or remember an AI result without a terminal', () => {
    const target = join(fixture.clients, 'petalworks');
    const counter = join(fixture.rootDir, 'ai-calls');
    const shim = join(fixture.rootDir, 'ai-shim');
    writeFileSync(
      shim,
      `#!/bin/sh\nprintf 'called\\n' >> '${counter}'\nprintf '%s' '{"path":"${target}","reason":"flowers"}'\n`,
    );
    chmodSync(shim, 0o755);
    writeConfig(fixture, { enabled: true, command: shim, args: [], model: '' });
    writeFileSync(
      join(fixture.dataDir, 'db.json'),
      JSON.stringify({ version: 1, records: [{ path: target, visits: 10, lastVisit: NOW }] }),
    );
    expect(runCli('index', '--refresh').status).toBe(0);
    const args = ['query', '--', 'that', 'client', 'with', 'flowers'];
    const first = runCli(...args);
    expect(first.status).toBe(3);
    expect(first.stdout).toBe('');
    expect(first.stderr).toContain('[no terminal, declined]');
    expect(runCli(...args).status).toBe(3);
    expect(existsSync(counter)).toBe(false);
    expect(existsSync(join(fixture.dataDir, 'aliases.json'))).toBe(false);
  });

  it('reuses an explicitly confirmed AI intent without a second backend call', () => {
    const target = join(fixture.clients, 'petalworks');
    const counter = join(fixture.rootDir, 'confirmed-ai-calls');
    const shim = join(fixture.rootDir, 'confirmed-ai-shim');
    writeFileSync(
      shim,
      `#!/bin/sh\nprintf 'called\\n' >> '${counter}'\nprintf '%s' '{"path":"${target}","reason":"flowers"}'\n`,
    );
    chmodSync(shim, 0o755);
    writeConfig(fixture, { enabled: true, command: shim, args: [], model: '' });
    writeFileSync(
      join(fixture.dataDir, 'db.json'),
      JSON.stringify({ version: 1, records: [{ path: target, visits: 10, lastVisit: NOW }] }),
    );
    expect(runCli('index', '--refresh').status).toBe(0);
    const args = ['query', '--', 'that', 'client', 'with', 'flowers'];
    const confirmed = runCliWithTty('y\n', ...args);
    expect(confirmed.status).toBe(0);
    expect(confirmed.output).toContain(target);
    expect(runCli(...args).stdout.trim()).toBe(target);
    expect(readFileSync(counter, 'utf8').trim().split('\n')).toEqual(['called']);
  });

  it('invalidates a confirmed intent when its target is missing', () => {
    writeConfig(fixture);
    expect(runCli('index', '--refresh').status).toBe(0);
    writeFileSync(
      join(fixture.dataDir, 'aliases.json'),
      JSON.stringify({
        version: 1,
        aliases: [{ query: 'that missing client', path: join(fixture.clients, 'ghost'), updatedAt: NOW }],
      }),
    );
    expect(runCli('query', '--', 'that', 'missing', 'client').status).toBe(1);
    const aliases = JSON.parse(readFileSync(join(fixture.dataDir, 'aliases.json'), 'utf8')) as {
      aliases: unknown[];
    };
    expect(aliases.aliases).toEqual([]);
  });
});

const loadConfigFrom = (target: Fixture) => {
  process.env['CDAI_CONFIG_DIR'] = target.configDir;
  try {
    return loadConfig();
  } finally {
    delete process.env['CDAI_CONFIG_DIR'];
  }
};
