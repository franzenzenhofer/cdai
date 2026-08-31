import { COMPLETION, SCORE } from './constants.js';
import { fuzzyScore, matchName } from './score.js';

export type CompletionKind = 'literal' | 'compact' | 'typo';

export interface CompletionMatch {
  readonly kind: CompletionKind;
  readonly strength: number;
}

export const completionKindRank = (kind: CompletionKind): number =>
  kind === 'literal' ? 2 : 1;

/** Classifies only matches safe enough to replace the active shell word. */
export const smartNameMatch = (fragment: string, name: string): CompletionMatch | undefined => {
  if (fragment === '') return undefined;
  const token = fragment.toLowerCase();
  const lower = name.toLowerCase();
  const literal = matchName(token, lower);
  if (literal >= SCORE.prefix) return { kind: 'literal', strength: literal };
  if (token.length < COMPLETION.minSmartLength) return undefined;
  if (literal >= SCORE.substring) return { kind: 'literal', strength: literal };
  const compact = fuzzyScore(token, lower);
  if (token[0] === lower[0] && compact > SCORE.none) return { kind: 'compact', strength: compact };
  if (compact > SCORE.none) return undefined;
  return literal > SCORE.none ? { kind: 'typo', strength: literal } : undefined;
};

export const isSmartNameMatch = (fragment: string, name: string): boolean =>
  smartNameMatch(fragment, name) !== undefined;
