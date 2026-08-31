import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolveExecutable } from '../executable.js';
import { EXIT, fail, note, type ExitCode } from '../protocol.js';
import { updateDb } from '../store/db.js';
import { DAY_SECONDS, type VisitRecord } from '../store/frecency.js';

const ZOXIDE = 'zoxide';
const ZOXIDE_ARGS = ['query', '--list', '--score'];
const MILLIS_PER_SECOND = 1000;
const MIN_VISITS = 1;

/** `zoxide query --list --score` prints right aligned "score path" pairs. */
export const parseZoxideList = (stdout: string, nowSeconds: number): VisitRecord[] => {
  const records: VisitRecord[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s+(.+)$/.exec(line);
    if (match === null) continue;
    const [, score, path] = match;
    if (score === undefined || path === undefined) continue;
    records.push({
      path,
      visits: Math.max(MIN_VISITS, Math.round(Number.parseFloat(score))),
      /** Imported history is dated one day back, so it ranks below anything visited today. */
      lastVisit: nowSeconds - DAY_SECONDS,
    });
  }
  return records;
};

export const runImportZoxide = (): ExitCode => {
  if (resolveExecutable(ZOXIDE) === null) {
    fail('zoxide not found on PATH', 'nothing to import');
    return EXIT.error;
  }
  const result = spawnSync(ZOXIDE, ZOXIDE_ARGS, { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`zoxide exited with ${String(result.status)}`, result.stderr.trim());
    return EXIT.error;
  }
  const nowSeconds = Math.floor(Date.now() / MILLIS_PER_SECOND);
  const imported = parseZoxideList(result.stdout, nowSeconds).filter((r) => existsSync(r.path));
  updateDb((db) => {
    const byPath = new Map(db.records.map((record) => [record.path, record]));
    for (const record of imported) {
      if (byPath.has(record.path)) continue;
      byPath.set(record.path, record);
    }
    return { ...db, records: [...byPath.values()] };
  });
  note(`cdai: imported ${imported.length} paths from zoxide`);
  return EXIT.ok;
};
