import { contractTilde } from '@franzenzenhofer/intent-core/paths';
import type { LearnAnswer, LearnedAlias } from './answer.js';

/** A suggested alias after cdai checked it, and what the person said to it. */
export interface VettedAlias extends LearnedAlias {
  /** Why cdai refused it on its own, or null when it was fit to offer. */
  readonly refused: string | null;
  readonly accepted: boolean | null;
}

export interface ReportInput {
  readonly at: Date;
  readonly backend: string;
  readonly decisions: number;
  readonly totals: Readonly<Record<string, number>>;
  readonly answer: LearnAnswer;
  readonly aliases: readonly VettedAlias[];
}

const aliasLine = (alias: VettedAlias): string => {
  const state = alias.refused !== null ? `refused: ${alias.refused}`
    : alias.accepted === true ? 'remembered' : alias.accepted === false ? 'declined' : 'not asked';
  return `- \`${alias.words}\` -> \`${contractTilde(alias.path)}\` - ${alias.why} (${state})`;
};

const section = (title: string, lines: readonly string[]): string[] =>
  ['', `## ${title}`, '', ...(lines.length === 0 ? ['None.'] : lines)];

/** The whole run as Markdown: kept on disk, so what was learned can be read again later. */
export const renderReport = (input: ReportInput): string => [
  `# cdai learn - ${input.at.toISOString()}`,
  '',
  `${input.decisions} decisions read, analysed by ${input.backend}.`,
  ...section('Summary', [input.answer.summary]),
  ...section('Aliases', input.aliases.map(aliasLine)),
  ...section('Settings (shown, never run)', input.answer.settings.map((s) => `- \`${s.command}\` - ${s.why}`)),
  ...section('Ideas to improve cdai', input.answer.improvements.flatMap((idea) => [
    `### ${idea.title}`, '', `Evidence: ${idea.evidence}`, '', `Proposal: ${idea.proposal}`, '',
  ])),
  ...section('Numbers', Object.entries(input.totals).map(([key, value]) => `- ${key}: ${String(value)}`)),
  '',
].join('\n');
