import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { Fixture } from './fixtures.js';

export const REPO = process.cwd();
export const BIN = join(REPO, 'dist', 'cdai.js');

export interface CliRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The built executable against a fixture's own config and state, never the user's. */
export const runCliIn = (fixture: Fixture, args: readonly string[], cwd = fixture.rootDir): CliRun => {
  const result = spawnSync('node', [BIN, ...args], {
    encoding: 'utf8',
    cwd,
    env: {
      PATH: process.env['PATH'] ?? '',
      HOME: fixture.rootDir,
      CDAI_CONFIG_DIR: fixture.configDir,
      CDAI_DATA_DIR: fixture.dataDir,
    },
  });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
};

export const buildBundle = (): number =>
  spawnSync('node', [join(REPO, 'scripts', 'build.mjs')], { encoding: 'utf8' }).status ?? -1;
