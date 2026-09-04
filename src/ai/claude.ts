/**
 * Claude's non-interactive contract is isolated here because its flags are provider-specific.
 *
 * `--safe-mode` and `--system-prompt` matter as much as `-p`: without them the CLI boots a full
 * agent session for what is a one shot classification - it loads the user's CLAUDE.md, project
 * settings, skills, hooks and MCP servers, which costs seconds and tens of thousands of tokens
 * per `cd` and makes the model answer in prose instead of the one JSON object cdai asked for.
 *
 * `--json-schema` is the same contract enforced by the CLI rather than requested in words: the
 * answer arrives in `structured_output` already shaped, so a chatty turn cannot produce the
 * "unparseable answer" dead end at all.
 */
const SYSTEM_PROMPT =
  'You are a path classifier. Reply with exactly one JSON object and no other text, '
  + 'no preamble, no explanation, no code fence.';

const ANSWER_SCHEMA = JSON.stringify({
  type: 'object',
  properties: { path: { type: ['string', 'null'] }, reason: { type: 'string' } },
  required: ['path', 'reason'],
  additionalProperties: false,
});

export const claudeArgs = (
  extraArgs: readonly string[],
  model: string,
  prompt: string,
): string[] => [
  ...extraArgs,
  '-p',
  '--model',
  model,
  '--output-format',
  'json',
  '--tools',
  '',
  '--safe-mode',
  '--strict-mcp-config',
  '--system-prompt',
  SYSTEM_PROMPT,
  '--json-schema',
  ANSWER_SCHEMA,
  '--no-session-persistence',
  prompt,
];
