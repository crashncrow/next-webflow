// Copies the real API responses saved by the contract test into the committed MSW fixtures, so
// unit tests run on authentic data. Run `WEBFLOW_CONTRACT=1 pnpm test:contract` first, then
// `pnpm fixtures:update`, and review the diff (fixtures come from the TEST site only).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUTPUT_DIR = fileURLToPath(new URL("../test/contract/output/", import.meta.url));
const FIXTURES_DIR = fileURLToPath(new URL("../test/fixtures/api/", import.meta.url));
const FILES = ["site-collections.json", "collection.json", "collections.json", "authors-items-live.json", "items-live.json", "items-staged.json"];

const missing = FILES.filter((file) => !existsSync(`${OUTPUT_DIR}${file}`));
if (missing.length > 0) {
  console.error(`Missing ${missing.join(", ")} in ${OUTPUT_DIR}. Run WEBFLOW_CONTRACT=1 pnpm test:contract first.`);
  process.exit(1);
}

mkdirSync(FIXTURES_DIR, { recursive: true });
for (const file of FILES) copyFileSync(`${OUTPUT_DIR}${file}`, `${FIXTURES_DIR}${file}`);
console.log(`Copied ${FILES.join(", ")} to ${FIXTURES_DIR}`);
