const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Webflow DateTime fields are ISO strings. */
export const formatDate = (iso: string | null | undefined) => (iso ? dateFormat.format(new Date(iso)) : undefined);

/** "Ada, Grace and Linus", skipping references that resolved to `null`. */
export const names = (items: ReadonlyArray<{ fieldData: { name: string } } | null | undefined>) =>
  new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(
    items.flatMap((item) => (item ? [item.fieldData.name] : [])),
  );

/** Rich Text as plain text, for excerpts and reading time (not for rendering: use WebflowRichText). */
export function plainText(html: string): string {
  // A scanner, not regex replacements: every `<` starts markup that's skipped, so the result never
  // contains one, and <script>/<style> contents are skipped up to their closing tag.
  const lower = html.toLowerCase();
  let text = "";
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf("<", i);
    if (open === -1) {
      text += html.slice(i);
      break;
    }
    text += `${html.slice(i, open)} `;
    const close = html.indexOf(">", open);
    if (close === -1) break; // unterminated tag: drop the rest
    i = close + 1;
    const raw = /^<(script|style)\b/.exec(lower.slice(open, close))?.[1];
    if (raw) {
      const end = lower.indexOf(`</${raw}`, i);
      const endClose = end === -1 ? -1 : html.indexOf(">", end);
      i = endClose === -1 ? html.length : endClose + 1;
    }
  }
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function excerpt(html: string, length = 160): string {
  const text = plainText(html);
  return text.length > length ? `${text.slice(0, length).replace(/\s+\S*$/, "")}…` : text;
}

/** The Number field if the editor set it, else ~220 words per minute. */
export const readingMinutes = (body: string, readingTime: number | undefined) =>
  readingTime && readingTime > 0
    ? Math.ceil(readingTime)
    : Math.max(1, Math.ceil(plainText(body).split(" ").length / 220));

/** Link and File fields hold any URL the editor typed: only render https ones as links. */
export function httpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Webflow's API returns Rich Text code blocks empty (`<pre></pre>`): tell readers instead of hiding it. */
export const hasEmptyCodeBlock = (html: string) => /<pre\b[^>]*>\s*<\/pre>/i.test(html);
