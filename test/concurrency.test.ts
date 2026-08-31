import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAliases } from '../src/store/aliases.js';
import { loadDb } from '../src/store/db.js';
import { makeFixture, type Fixture } from './fixtures.js';

const WORKERS = 16;
const VISITS = 200;
let fixture: Fixture;

const runWorker = (source: string, extraEnv: Record<string, string> = {}): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], {
      cwd: process.cwd(),
      env: { ...process.env, CDAI_DATA_DIR: fixture.dataDir, ...extraEnv },
      stdio: 'ignore',
    });
    child.on('close', (status) => resolve(status ?? -1));
  });

beforeEach(() => {
  fixture = makeFixture();
  process.env['CDAI_DATA_DIR'] = fixture.dataDir;
});

afterEach(() => {
  fixture.cleanup();
  delete process.env['CDAI_DATA_DIR'];
});

describe('cross-process state transactions', () => {
  it('ingests every claimed visit exactly once under contention', async () => {
    for (let i = 0; i < VISITS; i += 1) {
      writeFileSync(
        join(fixture.dataDir, `visits.log.ingest.999.${String(i)}`),
        `${String(1_700_000_000 + i)}\t/bulk\n`,
      );
    }
    const source = `import { ingest } from './src/store/db.ts'; ingest();`;
    expect(await Promise.all(Array.from({ length: WORKERS }, () => runWorker(source))))
      .toEqual(Array.from({ length: WORKERS }, () => 0));
    expect(loadDb().records.find((record) => record.path === '/bulk')?.visits).toBe(VISITS);
  });

  it('preserves every concurrent confirmed alias update', async () => {
    const source = `import { rememberAlias } from './src/store/aliases.ts'; rememberAlias(process.env.ALIAS_QUERY ?? '', '/target', 1);`;
    const statuses = await Promise.all(
      Array.from({ length: WORKERS }, (_, i) => runWorker(source, { ALIAS_QUERY: `intent ${String(i)}` })),
    );
    expect(statuses).toEqual(Array.from({ length: WORKERS }, () => 0));
    expect(loadAliases().aliases).toHaveLength(WORKERS);
  });

  it('recovers one crashed owner and reclaimer without overlapping transactions', async () => {
    const stateFile = join(fixture.dataDir, 'counter.json');
    const lockDir = `${stateFile}.lock`;
    const counter = join(fixture.dataDir, 'counter.txt');
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: 2_147_000_000, token: 'dead-owner', createdAt: 0 }));
    writeFileSync(join(lockDir, 'reclaim'), JSON.stringify({ pid: 2_146_999_999, token: 'dead-reclaimer', createdAt: 0 }));
    writeFileSync(counter, '0');
    const source = [
      `import { readFileSync, writeFileSync } from 'node:fs';`,
      `import { withStateLock } from './src/store/lock.ts';`,
      `const wait = new Int32Array(new SharedArrayBuffer(4));`,
      `withStateLock(process.env.STATE_FILE ?? '', () => {`,
      `  const value = Number(readFileSync(process.env.COUNTER ?? '', 'utf8'));`,
      `  Atomics.wait(wait, 0, 0, 5);`,
      `  writeFileSync(process.env.COUNTER ?? '', String(value + 1));`,
      `});`,
    ].join('\n');
    const statuses = await Promise.all(Array.from({ length: WORKERS }, () =>
      runWorker(source, { STATE_FILE: stateFile, COUNTER: counter })));
    expect(statuses).toEqual(Array.from({ length: WORKERS }, () => 0));
    expect(readFileSync(counter, 'utf8')).toBe(String(WORKERS));
  });
});
