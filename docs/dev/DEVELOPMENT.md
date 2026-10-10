# Development setup

Install the published dependencies with the committed lockfile:

```sh
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check
pnpm build && pnpm smoke:bun
```

`bin/zm` runs the local executable. OAuth tests use a memory keyring and a loopback listener;
source and ingestion tests use invented meetings and the shared memory store.

The native binding requires cli-messaging's public meeting adapter and stored account lookup API.
Until those APIs are published, this branch remains a draft: local validation against a built
producer snapshot does not establish that registry dependencies are ready. Do not substitute a
local artifact path in the committed manifest or use the test memory store for the owner's data.
