// Pre-deploy checks for `webflow apps deploy`:
// - No .env* files of any mode (.env, .env.local, .env.production, .env.development.local, .env.test…)
//   in the app directory or in the project root above it (the nearest parent folder with a lockfile,
//   as in a monorepo): secrets go to Webflow Cloud with `webflow apps env-vars import local.env --secret`
//   instead. `*.example` files are allowed.
// - Without our open-next.config.ts the builder generates one with dummy caches (no data cache), and
//   it deletes ours after each deploy: restore it with `git checkout -- open-next.config.ts`.
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const LOCKFILES = ["bun.lockb", "bun.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"];

const appDir = process.cwd();

// The nearest folder (the app's or a parent) with a lockfile; the app itself if there's none.
function findProjectRoot(dir) {
  for (let current = dir; ; current = path.dirname(current)) {
    if (LOCKFILES.some((name) => existsSync(path.join(current, name)))) return current;
    if (path.dirname(current) === current) return dir;
  }
}

function envFilesIn(dir) {
  return readdirSync(dir)
    .filter((name) => (name === ".env" || name.startsWith(".env.")) && !name.endsWith(".example"))
    .filter((name) => statSync(path.join(dir, name)).isFile())
    .map((name) => path.relative(appDir, path.join(dir, name)));
}

const problems = [];
const projectRoot = findProjectRoot(appDir);
const envFiles = [...new Set([appDir, projectRoot])].flatMap(envFilesIn);
if (envFiles.length > 0) {
  problems.push(
    `${envFiles.join(", ")} found: don't deploy with secrets in .env* files (any mode, app or project root). ` +
      "Move the values to local.env (see local.env.example) and delete these files.",
  );
}
if (!existsSync("open-next.config.ts")) {
  problems.push("open-next.config.ts is missing (the builder deletes it). Run `git checkout -- open-next.config.ts`.");
}
if (problems.length > 0) {
  console.error(`Refusing to deploy:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
