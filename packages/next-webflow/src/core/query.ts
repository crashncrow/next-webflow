export type QueryPrimitive = string | number | boolean;
export type QueryValue =
  | QueryPrimitive
  | readonly QueryValue[]
  | { readonly [key: string]: QueryValue | undefined };
export type QueryParams = { readonly [key: string]: QueryValue | undefined };

/**
 * Serializes nested params with bracket notation, as the Webflow API expects:
 * `{ filter: { color: { in: ["a", "b"] } } }` → `filter[color][in][0]=a&filter[color][in][1]=b`.
 * `undefined` values are skipped.
 */
export function toSearchParams(query: QueryParams): URLSearchParams {
  const params = new URLSearchParams();

  const append = (key: string, value: QueryValue | undefined): void => {
    if (value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((entry: QueryValue, index) => append(`${key}[${index}]`, entry));
    } else if (typeof value === "object") {
      for (const [child, entry] of Object.entries(value)) append(`${key}[${child}]`, entry);
    } else {
      params.append(key, String(value));
    }
  };

  for (const [key, value] of Object.entries(query)) append(key, value);
  return params;
}
