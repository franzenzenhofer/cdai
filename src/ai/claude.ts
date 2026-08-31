/** Claude's non-interactive contract is isolated here because its flags are provider-specific. */
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
  '--no-session-persistence',
  prompt,
];
