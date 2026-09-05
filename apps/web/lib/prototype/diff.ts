export interface DiffToken {
  type: string;
  start: number;
  end: number;
}

function lineType(line: string): string | undefined {
  if (line.startsWith("+++") || line.startsWith("---")) return "keyword";
  if (line.startsWith("@@")) return "comment";
  if (line.startsWith("+")) return "string";
  if (line.startsWith("-")) return "tag";
  return undefined;
}

export function tokenizeDiff(code: string): DiffToken[] {
  const tokens: DiffToken[] = [];
  let offset = 0;
  for (const line of code.split("\n")) {
    const type = lineType(line);
    if (type && line.length > 0) tokens.push({ type, start: offset, end: offset + line.length });
    offset += line.length + 1;
  }
  return tokens;
}
