import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, serializeConfig } from '../src/config.js';
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
  it('reads roots with defaults, weights and declared aliases', () => {
    writeRawConfig({
      roots: [fixture.projects, { path: fixture.clients, depth: 3, weight: 250 }],
      aliases: { 'The Flower Client': join(fixture.clients, 'petalworks') },
    });
    const config = loadConfig();
    expect(config.roots).toEqual([
      { path: fixture.projects, depth: 2 },
      { path: fixture.clients, depth: 3, weight: 250 },
    ]);
    expect(config.aliases).toEqual([{ query: 'the flower client', path: join(fixture.clients, 'petalworks') }]);
    expect(config.ignore.length).toBeGreaterThan(0);
  });

  it('round-trips through the file shape without inventing weights', () => {
    writeRawConfig({ roots: [{ path: fixture.projects, depth: 2 }], aliases: { orbit: '~/orbit' } });
    const text = serializeConfig(loadConfig());
    expect(text).not.toContain('weight');
    expect(JSON.parse(text)).toMatchObject({ aliases: { orbit: join(process.env['HOME'] ?? '', 'orbit') } });
  });

  it.each([
    [{ roots: [' '] }, 'roots[0] must be a non-empty path'],
    [{ roots: ['relative/dir'] }, 'roots[0] must start with / or ~'],
    [{ roots: [{ path: '/a', depth: 3.9 }] }, 'roots[0].depth must be an integer from 1 to 64'],
    [{ roots: [{ path: '/a', depth: 1e100 }] }, 'roots[0].depth must be an integer from 1 to 64'],
    [{ roots: [{ path: '/a', weight: 5000 }] }, 'roots[0].weight must be an integer from -1000 to 1000'],
    [{ roots: [{ path: '/a', deep: 3 }] }, 'roots[0] has unknown key "deep"'],
    [{ roots: ['/a', { path: '/a' }] }, 'roots lists /a twice'],
    [{ ignore: 'node_modules' }, 'ignore must be an array'],
    [{ ai: { command: ' ' } }, 'ai.command must be a non-empty string'],
    [{ ai: { args: ['--flag', 42] } }, 'ai.args must be an array of strings'],
    [{ ai: { timeoutMs: 1.5 } }, 'ai.timeoutMs must be an integer'],
    [{ ai: { enabled: 'yes' } }, 'ai.enabled must be true or false'],
    [{ aliases: ['orbit'] }, 'aliases must be an object'],
    [{ aliases: { orbit: 'orbit' } }, 'aliases["orbit"] must start with / or ~'],
    [{ aliases: { 'Orbit ': '/a', orbit: '/b' } }, 'aliases["orbit"] is listed twice'],
    [{ root: [] }, 'config has unknown key "root"'],
  ])('fails loud on %j', (value, message) => {
    writeRawConfig(value);
    expect(() => loadConfig()).toThrow(message);
    expect(() => loadConfig()).toThrow(join(fixture.configDir, 'config.json'));
  });

  it('reports malformed user configuration instead of silently replacing it', () => {
    writeFileSync(join(fixture.configDir, 'config.json'), '{partial');
    expect(() => loadConfig()).toThrow();
  });
});
