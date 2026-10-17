# Development setup

Install the published dependencies with the committed lockfile and isolated state:

```sh
T=$(mktemp -d -p /var/tmp) && HOME=$T MESSAGING_STORE=$T/store WIRECAT_STATE_DIR=$T/state TMPDIR=$T NPM_CONFIG_USERCONFIG=/dev/null pnpm install --frozen-lockfile
```

Local commits check staged lint and secrets. Choose focused checks for the behavior you changed;
for example, run the bounded type check with a new temporary home:

```sh
T=$(mktemp -d -p /var/tmp) && HOME=$T MESSAGING_STORE=$T/store WIRECAT_STATE_DIR=$T/state TMPDIR=$T NPM_CONFIG_USERCONFIG=/dev/null pnpm ci:quick
```

Use the same fresh-state pattern for every build, test and CLI invocation. Main CI runs the full
Linux suite and coverage; release validation adds the installed Linux/Windows checks. See
[testing](TESTING.md) for the synthetic fixtures and individual check commands. Do not repeat the
whole suite locally after successful checks unless a new change, failure or unresolved risk requires it.

`bin/zm` runs the local executable. OAuth tests use a memory keyring and a loopback listener;
source and ingestion tests use invented meetings and the shared memory store.

The executable uses the published cli-core SQLite adapter for import, pull and stored reads.
Development checks must use invented fixtures, isolated HOME/config/state/cache directories and an
explicit MESSAGING_STORE path. Never run tests against the owner's default database or keyring.
Native persistence supports Node 22.16 or newer within 22.x, Node 24 or newer, and Bun.

`pnpm generate:check` checks the generated [command reference](../commands.md). `pnpm test:matrix`
measures CLI command and option coverage; its [matrix](test-matrix.md) records explicit exceptions.
[Architecture](ARCHITECTURE.md) and [testing](TESTING.md) describe the design and the checks;
[releasing](RELEASING.md) covers package checks and trusted publishing. Tests use an injected keyring,
scripted HTTP responses, temporary config folders and the memory meeting store.
