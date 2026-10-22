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

Node 22.22 for development (`.nvmrc`, root `engines`; the build needs ≥22.18) and pnpm (installed with `npm i -g pnpm`, not Corepack). Users only need what the library's `engines` says (Node 22.12+); CI also runs the library's tests on 22.12 and the latest LTS.

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
