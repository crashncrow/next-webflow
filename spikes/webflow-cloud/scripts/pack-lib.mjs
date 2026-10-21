// Builds the library and packs it into vendor/next-webflow.tgz, which package.json installs.
// The tarball is committed so Webflow Cloud (npm only, no workspace) can install it.
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const libDir = fileURLToPath(new URL("../../../packages/next-webflow/", import.meta.url));
const vendorDir = fileURLToPath(new URL("../vendor/", import.meta.url));

mkdirSync(vendorDir, { recursive: true });
execFileSync("pnpm", ["--filter", "next-webflow", "build"], { cwd: repoRoot, stdio: "inherit" });
const output = execFileSync("npm", ["pack", "--json", "--pack-destination", vendorDir], {
  cwd: libDir,
  encoding: "utf8",
});
const [{ filename }] = JSON.parse(output);
renameSync(`${vendorDir}${filename}`, `${vendorDir}next-webflow.tgz`);
console.log(`Packed ${filename} → vendor/next-webflow.tgz. Run \`npm install\` to update the spike.`);
