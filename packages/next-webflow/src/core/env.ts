export const ENV = {
  /** Site token for CMS reads. Not `WEBFLOW_API_TOKEN`: the Webflow CLI reads that one (a workspace token). */
  cmsToken: "WEBFLOW_CMS_TOKEN",
  siteId: "WEBFLOW_SITE_ID",
  webhookSecret: "WEBFLOW_WEBHOOK_SECRET",
  previewSecret: "WEBFLOW_PREVIEW_SECRET",
} as const;

/** The Webflow CLI's token variable. Never read; only mentioned when the CMS token is missing. */
export const WEBFLOW_CLI_TOKEN_ENV = "WEBFLOW_API_TOKEN";

/** Reads an environment variable without assuming `process` exists (some edge runtimes lack it). */
export function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}
