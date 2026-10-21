#!/usr/bin/env node
// CLI (Node only): `next-webflow typegen` and `next-webflow webhooks register|list|unregister`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { createWebflowClient } from "../core/client";
import { ENV, WEBFLOW_CLI_TOKEN_ENV } from "../core/env";
import { WebflowError } from "../core/errors";
import { parseEnvFile } from "./env-file";
import { DEFAULT_OUT_DIR, runTypegen } from "./typegen";
import { listWebhooks, registerWebhooks, unregisterWebhooks, type CliIO, type CommandContext } from "./webhooks";

const HELP = `Usage:
  next-webflow typegen [options]            Generate ${DEFAULT_OUT_DIR}/schema.ts (+ index.ts the first time)
  next-webflow webhooks <command> [options]

Webhook commands:
  register    Create signed webhooks (every CMS event + site_publish by default)
  list        Show the site's webhooks (API-created ones)
  unregister  Delete the webhooks pointing at --url (asks for confirmation)

typegen options:
  --out <dir>           Output folder (default: ${DEFAULT_OUT_DIR})
  --check               Don't write; exit 1 if schema.ts is missing or out of date (CI)
  --force               Recreate index.ts even if it exists (it's yours otherwise)

webhooks options:
  --url <https url>     Your webhook route, e.g. https://example.com/api/webflow
  --events <list>       Comma-separated (default: every CMS event and site_publish)
  --print               Print the secrets instead of writing them to the env file
  --yes                 unregister: don't ask for confirmation

Common options:
  --env-file <path>     Read config from it (default: .env.local); webhooks register appends
                        secrets to it. On Webflow Cloud use a file NOT named .env* (it would be bundled).
  --token-env <name>    Env var holding the site token (default: ${ENV.cmsToken}).
                        typegen: CMS: Read. webhooks: Sites: Read and write + CMS: Read,
                        so point it at a separate variable (e.g. WEBFLOW_ADMIN_TOKEN).
  --token <token>       The token itself (overrides --token-env). Prefer --token-env:
                        a literal token stays in your shell history.
  --site-id <id>        Default: ${ENV.siteId}
  -h, --help
`;

const io: CliIO = {
  log: (message) => console.log(message),
  warn: (message) => console.warn(`⚠ ${message}`),
  readFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
  writeFile(path, content, options) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { mode: options?.secret ? 0o600 : 0o644 });
  },
  async confirm(question) {
    if (!process.stdin.isTTY) return false;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
    } finally {
      rl.close();
    }
  },
};

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      url: { type: "string" },
      events: { type: "string" },
      "env-file": { type: "string", default: ".env.local" },
      print: { type: "boolean", default: false },
      "token-env": { type: "string", default: ENV.cmsToken },
      token: { type: "string" },
      "site-id": { type: "string" },
      yes: { type: "boolean", default: false },
      out: { type: "string", default: DEFAULT_OUT_DIR },
      check: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const [group, command] = positionals;
  if (values.help || !(group === "typegen" || (group === "webhooks" && command))) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }

  const envFile = values["env-file"];
  // process.env wins over the file, like Next.js.
  const fileEnv = { ...parseEnvFile(io.readFile(".env") ?? ""), ...parseEnvFile(io.readFile(envFile) ?? "") };
  const env = (name: string) => process.env[name] || fileEnv[name] || undefined;

  const tokenEnv = values["token-env"];
  const token = values.token ?? env(tokenEnv);
  const siteId = values["site-id"] ?? env(ENV.siteId);
  if (!token) {
    throw new WebflowError(
      `No API token: set ${tokenEnv} (in the environment or ${envFile}) or pass --token.` +
        (tokenEnv !== WEBFLOW_CLI_TOKEN_ENV && env(WEBFLOW_CLI_TOKEN_ENV)
          ? ` ${WEBFLOW_CLI_TOKEN_ENV} is set but isn't read: it's the Webflow CLI's variable (a workspace token).`
          : ""),
    );
  }
  if (!siteId) throw new WebflowError(`No site ID: set ${ENV.siteId} or pass --site-id.`);

  const tokenSource = values.token ? "--token" : tokenEnv;
  const context: CommandContext = { client: createWebflowClient({ token }), siteId, io, tokenEnv: tokenSource };
  if (group === "typegen") return runTypegen(context, { out: values.out, check: values.check, force: values.force });
  switch (command) {
    case "register":
      await registerWebhooks(context, { url: values.url, events: values.events, print: values.print, envFile });
      return 0;
    case "list":
      await listWebhooks(context);
      return 0;
    case "unregister":
      await unregisterWebhooks(context, { url: values.url, yes: values.yes });
      return 0;
    default:
      console.log(HELP);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
