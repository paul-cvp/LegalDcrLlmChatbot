export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ParsedJsonExcerpt {
  value: JsonValue;
  /** True when the excerpt was a truncated fragment that had to be repaired. */
  repaired: boolean;
}

export function isJsonSource(source: string | undefined): boolean {
  if (!source) return false;
  const path = source.split(/[?#]/)[0] ?? source;
  return /\.json$/i.test(path.trim());
}

/** Parses a JSON excerpt, recovering what it can from a chunk cut mid-document. */
export function parseJsonExcerpt(text: string): ParsedJsonExcerpt | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const direct = tryParse(trimmed);
  if (direct !== undefined) return { value: direct, repaired: false };

  for (const candidate of repairCandidates(trimmed)) {
    const value = tryParse(candidate);
    if (value !== undefined) return { value, repaired: true };
  }
  return undefined;
}

function tryParse(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

/**
 * Builds plausible completions of a fragment: it starts at the first container
 * bracket, closes an unterminated string, drops a dangling comma, completes a
 * dangling key, then closes every open bracket. Fragments that hold several
 * sibling items are additionally wrapped in an array.
 */
function repairCandidates(text: string): string[] {
  const start = text.search(/[[{]/);
  if (start < 0) return [];
  const body = text.slice(start);

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastSignificant = "";
  let index = 0;
  for (const char of body) {
    index += char.length;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      lastSignificant = char;
      continue;
    }
    if (/\s/.test(char)) continue;
    if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") {
      const open = stack.pop();
      if (open === undefined) {
        // The fragment began inside a container that closes here; retry after it.
        return repairCandidates(body.slice(index));
      }
      if ((char === "}" && open !== "{") || (char === "]" && open !== "[")) return [];
    }
    lastSignificant = char;
  }

  let head = body;
  if (inString) {
    if (escaped) head = head.slice(0, -1);
    head += "\"";
    lastSignificant = "\"";
  }
  head = head.trimEnd();
  if (lastSignificant === ",") head = head.slice(0, -1).trimEnd();
  if (lastSignificant === ":") head += " null";

  const closers = [...stack].reverse().map((open) => (open === "{" ? "}" : "]")).join("");
  const inObject = stack[stack.length - 1] === "{";
  const candidates = [head + closers];
  if (inObject && lastSignificant === "\"") candidates.push(`${head}: null${closers}`);
  candidates.push(...candidates.map((candidate) => `[${candidate}]`));
  return candidates;
}

/** Re-indents JSON-looking text without requiring it to be valid. */
export function formatJsonLoosely(text: string, indentSize = 2): string {
  const indent = " ".repeat(indentSize);
  let depth = 0;
  let inString = false;
  let escaped = false;
  let output = "";
  const newline = () => `\n${indent.repeat(depth)}`;

  for (const char of text.trim()) {
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    switch (char) {
      case "\"":
        inString = true;
        output += char;
        break;
      case "{":
      case "[":
        depth += 1;
        output += char + newline();
        break;
      case "}":
      case "]":
        depth = Math.max(0, depth - 1);
        output = output.trimEnd() + newline() + char;
        break;
      case ",":
        output = output.trimEnd() + char + newline();
        break;
      case ":":
        output += ": ";
        break;
      default:
        if (!/\s/.test(char)) output += char;
    }
  }
  return output
    .replace(/[{[]\n\s*([}\]])/g, (_, close: string) => (close === "}" ? "{}" : "[]"))
    .trim();
}
