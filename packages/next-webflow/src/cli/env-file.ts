import { parseSecrets } from "../core/webhook";

const lineFor = (key: string) => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=(.*)$`);

/** Reads `KEY=value` pairs (enough for the CLI's own variables; no multiline values). */
export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match?.[1]) values[match[1]] = unquote(match[2] ?? "");
  }
  return values;
}

/**
 * Adds `values` to a comma-separated variable in an env file's content, keeping existing values
 * (no duplicates) and every other line untouched. Appends the variable if it's missing.
 */
export function mergeEnvList(content: string, key: string, values: readonly string[]): string {
  const pattern = lineFor(key);
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));
  const existing = index === -1 ? [] : parseSecrets(unquote(pattern.exec(lines[index] ?? "")?.[1] ?? ""));
  const line = `${key}=${parseSecrets([...existing, ...values]).join(",")}`;

  if (index !== -1) {
    lines[index] = line;
    return lines.join("\n");
  }
  const base = content === "" || content.endsWith("\n") ? content : `${content}\n`;
  return `${base}${line}\n`;
}

function unquote(raw: string): string {
  const value = raw.trim();
  const quoted = /^(['"])(.*)\1$/.exec(value);
  return quoted ? (quoted[2] ?? "") : value.replace(/\s+#.*$/, "");
}
