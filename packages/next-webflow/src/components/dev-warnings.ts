const warned = new Set<string>();

/** `console.warn` once per key, only outside production builds. */
export function warnOnceInDev(key: string, message: string): void {
  if ((typeof process !== "undefined" && process.env.NODE_ENV === "production") || warned.has(key)) return;
  warned.add(key);
  console.warn(`[next-webflow] ${message}`);
}
