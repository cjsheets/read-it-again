export function parseArguments(arguments_: readonly string[]): {
  readonly command: string;
  readonly options: Readonly<Record<string, string>>;
} {
  const normalized = arguments_.filter((argument) => argument !== '--');
  const command = normalized[0] ?? 'help';
  const options: Record<string, string> = {};
  for (let index = 1; index < normalized.length; index += 1) {
    const argument = normalized[index];
    if (!argument?.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const [rawKey, inlineValue] = argument.slice(2).split('=', 2);
    if (!rawKey) throw new Error(`Invalid option: ${argument}`);
    if (inlineValue !== undefined) {
      options[rawKey] = inlineValue;
      continue;
    }
    const next = normalized[index + 1];
    if (next && !next.startsWith('--')) {
      options[rawKey] = next;
      index += 1;
    } else {
      options[rawKey] = 'true';
    }
  }
  return { command, options };
}
