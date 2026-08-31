import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve, sep } from 'node:path';

const isExecutableFile = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** Resolves like a shell PATH lookup while also accepting absolute and relative paths. */
export const resolveExecutable = (command: string): string | null => {
  if (command.trim() === '') return null;
  if (isAbsolute(command) || command.includes(sep)) {
    const path = resolve(command);
    return isExecutableFile(path) ? path : null;
  }
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    const candidate = join(dir === '' ? process.cwd() : dir, command);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
};
