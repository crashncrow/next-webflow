// Snapshots the test site's collections into src/webflow-schema.ts with `next-webflow typegen`
// (its schema.ts, copied). /library reads this snapshot to test the stale-schema fallback: run it,
// THEN add a new Option in Webflow. The committed snapshot predates that change on purpose; don't
// rerun it unless you're repeating the experiment.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.WEBFLOW_CMS_TOKEN || !process.env.WEBFLOW_SITE_ID) {
  throw new Error("Set WEBFLOW_CMS_TOKEN and WEBFLOW_SITE_ID in local.env");
}

const cli = fileURLToPath(new URL("../node_modules/next-webflow/dist/cli.mjs", import.meta.url));
const target = fileURLToPath(new URL("../src/webflow-schema.ts", import.meta.url));
const out = mkdtempSync(join(tmpdir(), "next-webflow-snapshot-"));
try {
  // Reads the token and site ID from the environment (local.env, loaded by the npm script).
  execFileSync(process.execPath, [cli, "typegen", "--out", out], { stdio: "inherit" });
  copyFileSync(join(out, "schema.ts"), target);
  console.log("Copied the generated schema to src/webflow-schema.ts");
} finally {
  rmSync(out, { recursive: true, force: true });
}
