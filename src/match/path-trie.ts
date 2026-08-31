interface PathNode {
  terminal: boolean;
  readonly children: Map<string, PathNode>;
}

const node = (): PathNode => ({ terminal: false, children: new Map() });

const segments = (path: string): string[] => path.split('/').filter((part) => part !== '');

/** Tracks paths and answers whether an ancestor, identical path, or descendant is present. */
export class PathChainSet {
  readonly #root = node();

  hasChain(path: string): boolean {
    let current = this.#root;
    for (const part of segments(path)) {
      if (current.terminal) return true;
      const next = current.children.get(part);
      if (next === undefined) return false;
      current = next;
    }
    return current.terminal || current.children.size > 0;
  }

  add(path: string): void {
    let current = this.#root;
    for (const part of segments(path)) {
      let next = current.children.get(part);
      if (next === undefined) {
        next = node();
        current.children.set(part, next);
      }
      current = next;
    }
    current.terminal = true;
  }
}
