# Development setup

Install the published dependencies with the committed lockfile:

```sh
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check
pnpm build && pnpm smoke:bun
```

`bin/zm` runs the local executable. OAuth tests use a memory keyring and a loopback listener;
source and ingestion tests use invented meetings and the shared memory store.

Real import and pull remain unavailable until cli-messaging publishes its SQLite meeting adapter
and account selection is connected. Do not use the test memory store for the owner's data.
