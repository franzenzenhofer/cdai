import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeDecision, parseLogArgs } from '../src/commands/log-cmd.js';
import { appendDecision, loadDecisions, MAX_LOG_BYTES, parseDecisions } from '../src/store/decisions.js';
import { decisionsLog } from '../src/state.js';
import { decisionEntry as entry, fixtureConfig, makeFixture, writeConfig, type Fixture } from './fixtures.js';
import { buildBundle, runCliIn, type CliRun } from './cli.js';

const PRIVATE_MODE = 0o600;
const MODE_BITS = 0o777;

let fixture: Fixture;

const runCli = (...args: string[]): CliRun => runCliIn(fixture, args);

const writeConfigWith = (extra: Record<string, unknown>): void => {
  const config = { ...JSON.parse(fixtureConfig(fixture)) as Record<string, unknown>, ...extra };
  writeFileSync(join(fixture.configDir, 'config.json'), JSON.stringify(config));
};

beforeAll(() => {
  expect(buildBundle()).toBe(0);
});

beforeEach(() => {
  fixture = makeFixture();
  process.env['CDAI_DATA_DIR'] = fixture.dataDir;
});

afterEach(() => {
  delete process.env['CDAI_DATA_DIR'];
  fixture.cleanup();
});

describe('the decision store', () => {
  it('skips a torn line and a line from another version instead of failing', () => {
    const good = JSON.stringify(entry());
    const parsed = parseDecisions(`${good}\n{"v":1,"at":\n${JSON.stringify({ ...entry(), v: 99 })}\n${good}\n`);
    expect(parsed).toHaveLength(2);
  });

  it('appends privately and keeps the newer half once the file outgrows its bound', () => {
    appendDecision(entry());
    expect(statSync(decisionsLog()).mode & MODE_BITS).toBe(PRIVATE_MODE);
    const line = `${JSON.stringify(entry({ words: ['old'] }))}\n`;
    writeFileSync(decisionsLog(), line.repeat(Math.ceil(MAX_LOG_BYTES / line.length) + 1));
    appendDecision(entry({ words: ['newest'] }));
    expect(statSync(decisionsLog()).size).toBeLessThanOrEqual(MAX_LOG_BYTES);
    expect(loadDecisions().at(-1)?.words).toEqual(['newest']);
  });
});

describe('cdai log', () => {
  it('reads -n and --json, and refuses anything else', () => {
    expect(parseLogArgs(['-n', '5', '--json'])).toEqual({ count: 5, json: true });
    expect(parseLogArgs(['-n', '0'])).toBeNull();
    expect(parseLogArgs(['--all'])).toBeNull();
  });

  it('says every question and the AI exchange under the decision', () => {
    const lines = describeDecision(entry({
      via: 'ai', rescanned: true,
      questions: [{ kind: 'confirm', options: ['/p/petalworks'], answer: '/p/petalworks' }],
      ai: { backend: 'claude sonnet', answered: true, note: 'flowers', offered: 12, ms: 900 },
    }));
    expect(lines[0]).toContain('"petal" -> /p/petalworks');
    expect(lines.slice(1).map((line) => line.trim())).toEqual([
      'rescanned the index',
      'asked to confirm, confirmed',
      'ai claude sonnet: chose, "flowers" (12 offered, 900ms)',
    ]);
  });
});

describe('every query leaves one line', () => {
  it('records a hit, a picker the person could not answer, and a miss', () => {
    writeConfig(fixture);
    expect(runCli('petalworks').status).toBe(0);
    runCli('tabletop');
    expect(runCli('zzzqqq').status).toBe(1);
    const [hit, picker, miss] = loadDecisions();
    expect(hit).toMatchObject({ via: 'hit', outcome: 'jump', path: join(fixture.clients, 'petalworks') });
    expect(picker).toMatchObject({ via: 'none', outcome: 'abort', path: null });
    expect(picker?.questions[0]).toMatchObject({ kind: 'picker', answer: null });
    expect(picker?.questions[0]?.options).toHaveLength(2);
    expect(miss).toMatchObject({ outcome: 'miss', rescanned: true });
  });

  it('records a pasted path, and shows it all in `cdai log`', () => {
    writeConfig(fixture);
    runCli(fixture.projects);
    const shown = runCli('log');
    expect(shown.status).toBe(0);
    expect(shown.stdout).toContain(' path ');
    expect(runCli('log', '--json').stdout.trim().split('\n')).toHaveLength(1);
    expect(runCli('log', 'path').stdout.trim()).toBe(join(fixture.dataDir, 'decisions.jsonl'));
  });

  it('writes nothing with "log": false', () => {
    writeConfigWith({ log: false });
    expect(runCli('petalworks').status).toBe(0);
    expect(existsSync(join(fixture.dataDir, 'decisions.jsonl'))).toBe(false);
    expect(runCli('log').stderr).toContain('logging is off');
  });

  it('rejects a log value that is not a boolean, naming the key', () => {
    writeConfigWith({ log: 'yes' });
    expect(runCli('config').stderr).toContain('log must be true or false');
    expect(readFileSync(join(fixture.configDir, 'config.json'), 'utf8')).toContain('"yes"');
  });
});
