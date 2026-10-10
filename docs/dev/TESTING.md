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
empty test user config. Package installation needs registry access; the CLI checks themselves do
not contact Zoom. The suite also checks imports, bin permissions and package-version agreement.

Persistent acceptance cases import invented files through the installed bin and read them in later
processes. Repeated imports preserve one transcript, corrections retain history while search sees
the current text, and reads of a missing profile leave account registration unchanged. All database
paths stay within the temporary installation; help and config commands must not create or touch it.
