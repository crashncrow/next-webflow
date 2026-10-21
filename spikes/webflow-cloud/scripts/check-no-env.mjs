// Pre-deploy checks for `webflow apps deploy`:
// - It builds locally, and OpenNext bakes every .env* file it finds into the worker bundle in plain
//   text. Secrets go to Webflow Cloud with `webflow apps env-vars import local.env --secret` instead.
// - Without our open-next.config.ts the builder generates one with dummy caches (no data cache), and
//   it deletes ours after each deploy: restore it with `git checkout -- open-next.config.ts`.
import { existsSync, readdirSync } from "node:fs";

const problems = [];
const envFiles = readdirSync(".").filter((name) => name.startsWith(".env"));
if (envFiles.length > 0) {
  problems.push(
    `${envFiles.join(", ")} would be bundled into the worker in plain text. ` +
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
