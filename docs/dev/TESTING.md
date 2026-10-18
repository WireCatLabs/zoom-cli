# Testing

Use focused local checks for the changed behavior. Commits run staged lint and secrets;
main CI owns the full Linux suite, coverage, docs/build and Bun checks. Releases additionally run
the installed-platform checks below. Tests script the HTTP transport and use cli-base's memory
keyring and the meetings module's memory store. OAuth tests use local loopback requests
with invented codes; they do not open a browser or connect to Zoom. Token refresh verifies that no
client secret or authorization header is sent.

`pnpm test` sandboxes itself (see "Command coverage"). Every other product CLI invocation from a branch uses
fresh temporary state on the same command line:

```sh
T=$(mktemp -d -p /var/tmp) && HOME=$T MESSAGING_STORE=$T/store WIRECAT_STATE_DIR=$T/state node dist/bin/zm.js --help
```

Never run a branch build against the owner's database, keyring or model directory. Domain assertions
use `scripts/testing/answers.ts` to validate the full public envelope against Base schemas before
reading its payload. MCP tests use real SDK clients and strict advertised output schemas. Installed
platform proofs validate every product answer and keep helper/embedding-fixture JSON separate.

Integration cases exercise command import and transcript search, grouped participant sessions,
API occurrence ids, missing scopes, corrected/idempotent imports, time zones and daylight-saving
ambiguity. Temporary config and transcript fixtures are `zm-test-*` directories inside the test file's
temporary root (see "Command coverage"). They contain only invented values and are removed with that root.

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

The development dependency pins `@wirecat/cli-testing` 0.5.2 from npm, with its
package integrity recorded in the lockfile.

### Stateful and upgrade checks

`pnpm contracts:upgrade` runs the pinned previous published package and this build against the
same fresh synthetic state. Baseline packages have a separate frozen lockfile under
`contracts/previous/`; they install only in full validation and do not add old CLI bins to the
normal developer executable path. The previous 0.2.1 binary creates the profile and imports the
transcript. The candidate must refuse its camelCase config without changing bytes or permissions.
A fixture-only adapter then models the documented owner key renaming, preserving every value and
the file mode. It runs only inside the contract runner's temporary root; it is not a product
migration. Candidate commands then verify retained meeting IDs, transcript, repeat-import
deduplication, search and exact export with overwrite refusal.
`pnpm security:no-leak` scans the reviewed contract fixtures and testing guide;
process diagnostics and recorded run logs are checked within the contract runner as well.
These commands run only in release, monthly and manual full validation. See the
[upgrade guide](https://github.com/WireCatLabs/cli-testing/blob/main/docs/ci/UPGRADES.md).

The installed preparation proof also captures explicit message, mail and document selections through
the published host API. It checks three conflicting dated statements, an excluded account, retained
coverage under projection, SDK/MCP parity, closed connections and an unchanged database digest.

## Command coverage

cli-base's shared setup (`@wirecat/cli-base/testing/setup`) runs first in every test file. It points the
temporary, home, XDG and Windows folders, every `*_CONFIG_DIR`, `*_STATE_DIR` and `*_CACHE_DIR`, and
`MESSAGING_STORE` at a fresh `wirecat-test-*` directory
([WC-TEST-1](https://github.com/WireCatLabs/cli-base/blob/main/docs/standards/testing.md#wc-test-1--point-every-path-a-test-could-write-at-a-temporary-directory),
[WC-STORE-14](https://github.com/WireCatLabs/cli-base/blob/main/docs/standards/store.md#wc-store-14--tests-never-open-the-owners-store)).
It replaces the OS keyring with one that throws, so tests pass `memoryKeyring()`, and refuses every connection
except to this machine
([WC-TEST-3](https://github.com/WireCatLabs/cli-base/blob/main/docs/standards/testing.md#wc-test-3--no-test-contacts-a-provider-or-the-network)).
No zm test calls `allowNetwork()`. Subprocesses inherit the sandbox. Stack-ordered hooks remove it after the
file's own resource-closing hooks. A worker that ends early, on an exit or a SIGTERM, removes its sandboxes on the way
out; only a process killed outright leaves one behind.
Command traces remain under `coverage/argv.jsonl`, with one previous run retained as
`coverage/argv.previous.jsonl`, instead of accumulating temporary backup directories.

`pnpm test:matrix` runs the offline suite and generates the [measured matrix](test-matrix.md).
The test-only Commander hook records command paths and option names in `coverage/argv.jsonl`;
it never records arguments or option values. Tests run with two workers to avoid local contention.
`pnpm test:matrix:check` consumes an existing full test run, including the coverage run in CI.
Exceptions in `scripts/test-matrix-untested.ts` identify the independent check and its reason.
The installed bin version exits before the action hook and is checked by package acceptance.
The generated [command reference](../commands.md) uses cli-base's shared command-page generator;
`pnpm generate:check` detects drift from the executable command tree.

## Installed platforms

Full manual validation and release validation pack once, then install that exact tarball on Linux
and Windows with Node 22.16.0 and 24.19.0. `scripts/installed-platform.mjs` exercises native SQLite
imports across processes, corrections, historical reads, no-overwrite export, local archive
verification, transcript append replays and corrections, fixed MCP account scope, cancellation and semantic
preview/generation/query checks against an invented loopback model. All paths,
including Windows APPDATA and LOCALAPPDATA, point into retained temporary directories. Runtime
guards reject external network, browser spawning and keyring loading; the semantic fixture allows only
its exact isolated loopback embedding endpoint. Registry access is limited to installation.
The jobs retain JSON proofs and check the validation tarball's SHA-256 before installation.

`scripts/installed-meeting-integration.mjs` adds fresh invented meetings, guests and events through
the installed public store. It checks link previews and compare-and-save, manual identity audit and
immediate account presence, explicit keyword indexing, configured word forms, hit continuation and
foreign-account cursor rejection. A one-second silent WAV previews without opening a model; applying
against an explicitly empty model directory reports the missing model without downloading anything.
Archive import assertions use exact creation, insertion, replay and supersession receipts. The helper
inspects audit rows only in its fresh fixture; product code uses the shared public services.

The same installed artifact checks batch file/stdin input, strict UTF-8 and input bounds before
store creation, independent query cursors, stale fingerprints, correlated budget refusals and
truthful JSONL end records. All meeting evidence is invented and guarded against external I/O.

Archive reads compare the opened file's identity with its path before reading bytes. This also
checks replacement races on Windows, where libuv does not support `O_NOFOLLOW`:
[libuv file-system flags](https://docs.libuv.org/en/v1.x/fs.html).

## Native writer ownership

`recording-writer-lease.test.ts` removes a fixture marker during ownership confirmation and proves
that archive creation fails before an asset download or manifest write. The existing recordings,
resume, cancellation and recovery tests exercise the provider binding to Core rather than a second
ownership implementation. Core separately tests a non-Zoom layout with actual two-process contention.

Release-installed `installed-writer-leases.mjs` uses the public Zoom and Core entries together. It
checks cross-account contention at one root, the existing marker layout, preview/applied stale
recovery, owned release and a verified archive. `installed-platform.mjs` requires that proof on every
Linux/Windows Node 22/24 installation, with explicit temporary HOME/store/WIRECAT_STATE_DIR and its
existing network/keyring guard. Candidate-file dependency checks are labelled separately and never
substitute for immutable released-package proof.

## Shared native partial storage

`recording-partial-store.test.ts` retains the transfer contract and existing resume/failure cases
against the thin Zoom binding to Core native persistence. An independently written legacy Zoom
checkpoint proves the existing locator hash, filenames and metadata bytes resume without migration.
Core separately owns short-I/O, malformed metadata, cancellation and handle-cleanup fault tests.

`installed-recording-partials.mjs` runs inside every existing Linux/Windows Node 22/24 installed
check. It uses Core's public native entry with a fictional second provider, recovers trailing bytes,
and resumes an independently seeded legacy Zoom checkpoint through the installed Zoom API. Its
transport is injected and its accounts, media and directories are invented. The platform proof
retains `native_partials`; the existing external-I/O/keyring guard remains active.

`scripts/installed-recording-publication.mjs` checks the shared native publication adapter with a
fictional provider, an interrupted commitment and a no-overwrite conflict. It separately seeds legacy
Zoom partial/checkpoint/promotion bytes without using the journal writer, then recovers through the
installed Zoom package without a recording download. Each installed platform retains these checks
under `native_publication` in its proof. Native filesystem fault injection stays in Core's tests;
consumer tests check observable compatibility and host metadata validation.

The installed upcoming proof also exercises scheduled inventory through the installed CLI and MCP.
Its injected provider transport retains old recurring hints, discards join URLs, rejects caller
account overrides before HTTP, refuses offline reads and proves that no store connection opens.
