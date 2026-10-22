// Removes script execution vectors from parsed Rich Text. CMS HTML is untrusted input (anyone with
// write access to the CMS, or a token, can put <script>, on* handlers or javascript: URLs in it) and
// html-react-parser doesn't sanitize, so this runs on every render unless `allowScripts`.
import { Element, type ChildNode } from "domhandler";

/** Removed with their content. `base` and `meta` can hijack URLs or refresh to `javascript:`. */
const BLOCKED_ELEMENTS = new Set(["script", "object", "embed", "applet", "base", "meta"]);

/** Attributes holding a URL (or URL list) that a browser may navigate to, load or execute. */
const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "xlink:href",
  "data",
  "poster",
  "background",
  "cite",
  "ping",
  "longdesc",
  "manifest",
  "codebase",
  "srcset",
  // SVG animation can set href to a URL: <animate attributeName="href" values="javascript:…">.
  "values",
  "to",
  "from",
  "by",
]);

/** `javascript:`, `vbscript:` and `data:`, ignoring case, whitespace and control characters (as browsers do). */
const DANGEROUS_URL = /^(?:javascript|vbscript|data):/i;
const normalizeUrl = (value: string) =>
  // eslint-disable-next-line no-control-regex
  value.replace(/[\u0000-\u0020\u007f]+/g, "").replace(/&#x?0*(?:58|3a);?/gi, ":");

function isDangerousUrlValue(name: string, value: string): boolean {
  // srcset ("a.jpg 1x, b.jpg 2x": URL then descriptor) and values ("x;y") hold lists: check every
  // entry. Elsewhere the whole value is the URL (browsers drop whitespace inside the scheme).
  const candidates =
    name === "srcset"
      ? value.split(",").map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
      : name === "values"
        ? value.split(";")
        : [value];
  return candidates.some((candidate) => DANGEROUS_URL.test(normalizeUrl(candidate)));
}

const DANGEROUS_STYLE = /javascript:|vbscript:|expression\s*\(|url\s*\(\s*['"]?\s*data:/i;

export interface SanitizeOptions {
  /** Keep everything (scripts, handlers, `javascript:` URLs, `srcdoc`, `<object>`, `<embed>`). */
  allowScripts?: boolean | undefined;
}

/** Sanitizes parsed nodes in place and returns them (blocked elements removed). */
export function sanitizeNodes<T extends ChildNode>(nodes: T[], options: SanitizeOptions = {}): T[] {
  if (options.allowScripts) return nodes;
  const kept: T[] = [];
  for (const node of nodes) {
    if (node instanceof Element) {
      if (BLOCKED_ELEMENTS.has(node.name.toLowerCase())) continue;
      sanitizeAttributes(node);
      node.children = sanitizeNodes(node.children, options);
    }
    kept.push(node);
  }
  return kept;
}

function isDangerousAttribute(rawName: string, value: string): boolean {
  const name = rawName.toLowerCase();
  return (
    name.startsWith("on") ||
    name === "srcdoc" ||
    (URL_ATTRIBUTES.has(name) && isDangerousUrlValue(name, value)) ||
    (name === "style" && DANGEROUS_STYLE.test(normalizeUrl(value)))
  );
}

/** Rebuilds `attribs` only when something is removed (most elements have nothing to remove). */
function sanitizeAttributes(element: Element): void {
  const entries = Object.entries(element.attribs);
  const kept = entries.filter(([name, value]) => !isDangerousAttribute(name, value));
  if (kept.length < entries.length) element.attribs = Object.fromEntries(kept);
}
