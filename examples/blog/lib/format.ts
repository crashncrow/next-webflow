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
  return (
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]*>/g, " ")
      // Drop any `<` or `>` left by malformed markup, so the result can never contain a tag.
      .replace(/[<>]/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim()
  );
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
