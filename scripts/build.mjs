import { build } from 'esbuild';
import { chmod, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_FILE = join(ROOT, 'dist', 'cdai.js');
const EXECUTABLE_MODE = 0o755;

await mkdir(dirname(OUT_FILE), { recursive: true });

await build({
  entryPoints: [join(ROOT, 'src', 'cli.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: OUT_FILE,
  minify: false,
  sourcemap: false,
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
});

await chmod(OUT_FILE, EXECUTABLE_MODE);
