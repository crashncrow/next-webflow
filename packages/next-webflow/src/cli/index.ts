#!/usr/bin/env node
// CLI (Node only): `next-webflow webhooks register|list|unregister`. Typegen arrives in stage 5.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { createWebflowClient } from "../core/client";
import { ENV } from "../core/env";
import { WebflowError } from "../core/errors";
import { parseEnvFile } from "./env-file";
import { listWebhooks, registerWebhooks, unregisterWebhooks, type CliIO, type CommandContext } from "./webhooks";

const HELP = `Usage: next-webflow webhooks <command> [options]

Commands:
  register    Create signed webhooks for the events that change live content
  list        Show the site's webhooks (API-created ones)
  unregister  Delete the webhooks pointing at --url (asks for confirmation)

Options:
  --url <https url>     Your webhook route, e.g. https://example.com/api/webflow
  --events <list>       Comma-separated (default: collection_item_published,
                        collection_item_unpublished,collection_item_deleted,site_publish)
  --env-file <path>     Read config from it and append secrets to it (default: .env.local).
                        On Webflow Cloud use a file NOT named .env* (it would be bundled).
  --print               Print the secrets instead of writing them to the env file
  --token-env <name>    Env var holding the API token (default: ${ENV.apiToken}).
                        Needs Sites: Read and write + CMS: Read.
  --site-id <id>        Default: ${ENV.siteId}
  --yes                 unregister: don't ask for confirmation
  -h, --help
`;

const io: CliIO = {
  log: (message) => console.log(message),
  warn: (message) => console.warn(`⚠ ${message}`),
  readFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
  writeFile: (path, content) => writeFileSync(path, content, { mode: 0o600 }),
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
      "token-env": { type: "string", default: ENV.apiToken },
      "site-id": { type: "string" },
      yes: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const [group, command] = positionals;
  if (values.help || group !== "webhooks" || !command) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }

  const envFile = values["env-file"];
  // process.env wins over the file, like Next.js.
  const fileEnv = { ...parseEnvFile(io.readFile(".env") ?? ""), ...parseEnvFile(io.readFile(envFile) ?? "") };
  const env = (name: string) => process.env[name] || fileEnv[name] || undefined;

  const tokenEnv = values["token-env"];
  const token = env(tokenEnv);
  const siteId = values["site-id"] ?? env(ENV.siteId);
  if (!token) throw new WebflowError(`No API token: set ${tokenEnv} (in the environment or ${envFile}).`);
  if (!siteId) throw new WebflowError(`No site ID: set ${ENV.siteId} or pass --site-id.`);

  const context: CommandContext = { client: createWebflowClient({ token }), siteId, io, tokenEnv };
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
