export const ENV = {
  apiToken: "WEBFLOW_API_TOKEN",
  siteId: "WEBFLOW_SITE_ID",
  webhookSecret: "WEBFLOW_WEBHOOK_SECRET",
  previewSecret: "WEBFLOW_PREVIEW_SECRET",
} as const;

/** Reads an environment variable without assuming `process` exists (some edge runtimes lack it). */
export function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}
