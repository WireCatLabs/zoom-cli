# Development setup

Install the published dependencies with the committed lockfile:

```sh
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check
pnpm build && pnpm smoke:bun
```

`bin/zm` runs the local executable. OAuth tests use a memory keyring and a loopback listener;
source and ingestion tests use invented meetings and the shared memory store.

The executable uses the published cli-messaging SQLite adapter for import, pull and stored reads.
Development checks must use invented fixtures, isolated HOME/config/state/cache directories and an
explicit MESSAGING_STORE path. Never run tests against the owner's default database or keyring.
Native persistence supports Node 22.16 or newer within 22.x, Node 24 or newer, and Bun.

`pnpm generate:check` checks the generated [command reference](../commands.md). `pnpm test:matrix`
measures CLI command and option coverage; its [matrix](test-matrix.md) records explicit exceptions.
[Architecture](ARCHITECTURE.md) and [testing](TESTING.md) describe the design and the checks;
[releasing](RELEASING.md) covers package checks and trusted publishing. Tests use an injected keyring,
scripted HTTP responses, temporary config folders and the memory meeting store.
