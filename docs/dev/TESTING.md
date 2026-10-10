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

The development dependency pins `@wirecat/cli-testing` 0.2.0 from npm, with its
package integrity recorded in the lockfile.
