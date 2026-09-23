import type { AiContract } from '@franzenzenhofer/intent-core/ai/cli-args';

/**
 * What cdai asks a model for: one path out of a closed list, or null, plus a short reason.
 *
 * The provider-specific flags that carry this contract live in the shared core; the contract
 * itself is cdai's, because only cdai knows it is asking about directories.
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

export const ANSWER_CONTRACT: AiContract = {
  systemPrompt: SYSTEM_PROMPT,
  schema: ANSWER_SCHEMA,
};
