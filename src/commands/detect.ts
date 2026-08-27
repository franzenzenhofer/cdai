import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RootConfig } from '../config.js';

export const DEV_DIR_NAMES = ['dev', 'code', 'src', 'projects', 'work', 'Developer', 'repos', 'git'];
export const DEV_DEPTH = 2;
export const CLOUD_DEPTH = 3;
export const CLOUD_PATTERN = /dropbox|google drive|onedrive|icloud|nextcloud/i;
/** A directory only counts as a project hub once it holds this many child directories. */
export const HUB_MIN_CHILDREN = 20;
export const CLOUD_SCAN_DEPTH = 4;
export const CLOUD_SCAN_MS = 3000;

const childDirs = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
};

interface Hub {
  readonly path: string;
  readonly children: number;
}

const scanHubs = (dir: string, depth: number, deadline: number, found: Hub[]): void => {
  if (depth > CLOUD_SCAN_DEPTH || Date.now() > deadline) return;
  const children = childDirs(dir);
  if (children.length >= HUB_MIN_CHILDREN) found.push({ path: dir, children: children.length });
  for (const child of children) scanHubs(child, depth + 1, deadline, found);
};

/** The busiest folder inside a cloud drive is almost always the client or project hub. */
export const bestHub = (cloudRoot: string, now: number = Date.now()): string | null => {
  const found: Hub[] = [];
  scanHubs(cloudRoot, 1, now + CLOUD_SCAN_MS, found);
  const best = [...found].sort((a, b) => b.children - a.children)[0];
  return best?.path ?? null;
};

export const cloudRoots = (home: string): string[] =>
  childDirs(home).filter((dir) => CLOUD_PATTERN.test(dir.slice(home.length + 1)));

export const detectRoots = (home: string = homedir()): RootConfig[] => {
  const roots: RootConfig[] = [];
  for (const name of DEV_DIR_NAMES) {
    const dir = join(home, name);
    if (existsSync(dir)) roots.push({ path: dir, depth: DEV_DEPTH });
  }
  for (const cloud of cloudRoots(home)) {
    const hub = bestHub(cloud);
    if (hub !== null) roots.push({ path: hub, depth: CLOUD_DEPTH });
  }
  return roots;
};
