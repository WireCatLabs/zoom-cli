# Testing

Run lint, typecheck, coverage, docs checks, build and Bun smoke. Tests script the HTTP transport and
use cli-core's memory keyring and cli-meetings' memory store. OAuth tests use local loopback requests
with invented codes; they do not open a browser or connect to Zoom. Token refresh verifies that no
client secret or authorization header is sent.

Integration cases exercise command import and transcript search, grouped participant sessions,
API occurrence ids, missing scopes, corrected/idempotent imports, time zones and daylight-saving
ambiguity. Temporary config and transcript fixtures live under `/tmp/zm-test-*`; they contain only
invented values and are retained until cleanup is approved.

The acceptance suite packs and installs the actual package in a fresh `zm-test-package-*` directory
and runs its installed bin. It overrides config/state/cache/store paths and installs a process guard
that rejects fetch, HTTP, browser spawning and keyring-module loading. npm installation uses an
empty test user/global configs and isolated HOME for packing, installation and build. Package
installation needs registry access; the CLI checks themselves do not contact Zoom. The suite checks
imports, correction history/current search, no-overwrite export, lazy MCP discovery/EOF, folder-watch
SIGINT/reopen, bin permissions and package-version agreement. Only Node 22's known SQLite experimental
warning is normalized in assertions; other stderr remains visible. Node 22.16/24 and Bun proofs use
actual registry dependencies and fresh invented databases, never a same-version local snapshot.

## Offline external contracts

`pnpm contracts:check` drives the built binary and MCP stdio server with isolated synthetic
profiles. It checks help, clean JSON discovery, structured error exit codes, and reviewed
tool schemas. Plans and snapshots live in `contracts/`; changes require explicit review with
`pnpm exec cli-contract contracts/plan.json --update`. It runs in release, monthly, and manual
full validation; ordinary PR/local checks retain their existing budget. See the
[shared guide](https://github.com/WireCatLabs/cli-testing/blob/main/docs/ci/CONTRACTS.md).

The development dependency pins `@wirecat/cli-testing` 0.3.0 from npm, with its
package integrity recorded in the lockfile.

### Stateful and upgrade checks

`pnpm contracts:upgrade` runs the pinned previous published package and this build against the
same fresh synthetic state. Baseline packages have a separate frozen lockfile under
`contracts/previous/`; they install only in full validation and do not add old CLI bins to the
normal developer executable path. Plans assert retained data, migration/import repeatability and
file preservation. `pnpm security:no-leak` scans the reviewed contract fixtures and testing guide;
process diagnostics and recorded run logs are checked within the contract runner as well.
These commands run only in release, monthly and manual full validation. See the
[upgrade guide](https://github.com/WireCatLabs/cli-testing/blob/main/docs/ci/UPGRADES.md).

## Command coverage

`pnpm test:matrix` runs the offline suite and generates the [measured matrix](test-matrix.md).
The test-only Commander hook records command paths and option names in `coverage/argv.jsonl`;
it never records arguments or option values. Tests run with two workers to avoid local contention.
`pnpm test:matrix:check` consumes an existing full test run, including the coverage run in CI.
Exceptions in `scripts/test-matrix-untested.ts` identify the independent check and its reason.
The installed bin version exits before the action hook and is checked by package acceptance.
The generated [command reference](../commands.md) uses cli-core's shared command-page generator;
`pnpm generate:check` detects drift from the executable command tree.

## Installed platforms

Full manual validation and release validation pack once, then install that exact tarball on Linux
and Windows with Node 22.16.0 and 24.19.0. `scripts/installed-platform.mjs` exercises native SQLite
imports across processes, corrections, historical reads, no-overwrite export, local archive
verification, symlink and replacement rejection, cancellation and default MCP reads. All paths,
including Windows APPDATA and LOCALAPPDATA, point into retained temporary directories. Runtime
guards reject network, browser spawning and keyring loading; registry access is limited to installation.
The jobs retain JSON proofs and check the validation tarball's SHA-256 before installation.

Archive reads compare the opened file's identity with its path before reading bytes. This also
checks replacement races on Windows, where libuv does not support `O_NOFOLLOW`:
[libuv file-system flags](https://docs.libuv.org/en/v1.x/fs.html).
