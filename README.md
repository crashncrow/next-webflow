# next-webflow

Use the **Webflow CMS as a headless content source in Next.js** (App Router, Next 15 and 16): generated types, caching with on-demand revalidation through webhooks, draft previews, and rendering components.

**Documentation:** [packages/next-webflow/README.md](packages/next-webflow/README.md)

| | |
| --- | --- |
| [`packages/next-webflow`](packages/next-webflow) | The library (`npm install next-webflow`, not published yet) |
| [`examples/blog`](examples/blog) | Example app: a blog with webhooks, previews and Rich Text |
| [`docs/`](docs) | Measurements and notes, e.g. the [Webflow Cloud spike](docs/webflow-cloud-spike.md) |
| [`spikes/webflow-cloud`](spikes/webflow-cloud) | The app used to verify Webflow Cloud (npm, outside the workspace) |

## Development

Node 22.22 (`.nvmrc`; CI tests exactly this version) and pnpm (installed with `npm i -g pnpm`, not Corepack).

```bash
pnpm install
pnpm lint
pnpm build      # before typecheck: the example type-checks against dist/
pnpm typecheck  # library + examples
pnpm test       # Vitest + MSW (API mocked), node and edge projects
WEBFLOW_CONTRACT=1 pnpm test:contract  # real API of a test site (packages/next-webflow/.env.local)
pnpm changeset  # describe a change for the changelog
```

## License

MIT © Diego Gennaro
