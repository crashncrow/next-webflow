# Contributing to next-webflow

Thanks for helping. Bugs and ideas go in [issues](https://github.com/crashncrow/next-webflow/issues); code changes in pull requests. Security problems don't go in issues: see [SECURITY.md](SECURITY.md).

## Setup

- **Node.js:** the version in `.nvmrc` (`nvm use`). The library supports users on Node.js 22.12+, but its development tools need the newer version.
- **pnpm:** the version in `package.json`'s `packageManager`, installed with `npm install -g pnpm`. Don't use Corepack: it can't run pnpm 12.

```bash
pnpm install
```

## Commands

```bash
pnpm format       # Prettier, whole repository (CI runs pnpm format:check)
pnpm lint
pnpm build        # before typecheck: the example app imports the built package
pnpm typecheck    # the library and examples/blog
pnpm test         # Node and edge tests with mocked API responses
```

CI runs all of them on every pull request, and the library's tests on Node.js 22.12, 24 and the latest LTS.

### Contract test (optional)

`pnpm test` never calls Webflow. A separate suite reads a real Webflow site to catch API changes. Use **your own test site**, never a site with real content, and a read-only token (CMS: Read, Sites: Read):

```bash
cp packages/next-webflow/.env.example packages/next-webflow/.env.local   # then fill it in
WEBFLOW_CONTRACT=1 pnpm test:contract
```

## Rules for code changes

- **Runtime code stays edge-compatible.** Everything except the CLI runs on edge runtimes (Cloudflare Workers, Webflow Cloud): use `fetch` and `crypto.subtle`, no Node.js modules (`node:*`), no `Buffer`. `packages/next-webflow/test/edge-compat.test.ts` bundles each entry point and fails on Node built-ins; add new entry points to it.
- **Route handlers don't export `runtime`.** `runtime = "edge"` fails on Webflow Cloud; the default runtime works everywhere.
- **Tests print nothing when they pass.** Assert expected warnings with `vi.spyOn(console, "warn")` instead of letting them print. Check with `npx vitest run --project node --project edge --silent=false` from `packages/next-webflow`.
- **Some tests only change on purpose.** `packages/next-webflow/test/core/cache-keys.test.ts` pins every request URL, and URLs are cache keys: changing one throws away users' cached data. `packages/next-webflow/test/exports.test.ts` pins the public API. If your change needs to update either, say why in the pull request.
- **Fixtures are real data.** `packages/next-webflow/test/fixtures/api/` holds real responses from a test site, refreshed with `pnpm --filter next-webflow fixtures:update` after a contract run. Don't edit them by hand, and never commit tokens, emails or personal names in them.
- **Generated code is checked byte for byte.** After changing typegen, refresh the golden file with `UPDATE_GOLDEN=1 pnpm test` and review the diff.
- **Never commit secrets.** All `.env*` files are git-ignored except `.env.example`; keep it that way.
- **Code, comments, docs and commit messages are in English.**

## Documentation

- `packages/next-webflow/README.md` is what npm shows: usage only. Link to other files with full GitHub URLs (`https://github.com/crashncrow/next-webflow/blob/main/…`), because relative links break on npmjs.com.
- Internals and measurements go in `docs/details.md`; Webflow Cloud setup in `docs/webflow-cloud.md`.
- Webflow behavior that differs from Webflow's docs is explained once, in the README's "Known limitations".
- `skills/next-webflow/SKILL.md` is the agent skill: a short version of the README plus the rules agents get wrong. When a change affects the public API, CLI flags, setup steps or a known limitation, update the skill in the same pull request.

## Changesets and formatting

- Describe every library change for the changelog with `pnpm changeset` (the example app is ignored).
- Prettier is pinned to an exact version on purpose, and Dependabot doesn't update it: a new version can reformat code. Update it by hand in its own pull request, together with the reformat. Add a commit that only reformats to `.git-blame-ignore-revs`.
