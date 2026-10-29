import { contractTilde, isDirectory, isProtocolSafePath } from '@franzenzenhofer/intent-core/paths';
import { EXIT, fail, jump, type ExitCode } from '../protocol.js';

export const jumpKnown = (path: string): ExitCode => {
  if (!isProtocolSafePath(path)) {
    fail('matched path contains a line break unsupported by shell transport');
    return EXIT.error;
  }
  jump(path);
  return EXIT.ok;
};

/**
 * Reached only with a freshly scanned index behind it, so the match was a directory moments ago
 * and is not one now. Rebuilding the cache is exactly what already happened, so the honest report
 * is that it went away under us - a rename, a delete, or a symlink that stopped pointing anywhere.
 */
export const jumpExisting = (path: string): ExitCode => {
  if (!isDirectory(path)) {
    fail(`${contractTilde(path)} stopped being a directory during this lookup`);
    return EXIT.error;
  }
  return jumpKnown(path);
};
