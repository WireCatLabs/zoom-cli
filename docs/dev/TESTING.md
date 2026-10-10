# Testing

Run lint, typecheck, coverage, docs checks, build and Bun smoke. Tests script the HTTP transport and
use cli-core's memory keyring and cli-meetings' memory store. OAuth tests use local loopback requests
with invented codes; they do not open a browser or connect to Zoom. Token refresh verifies that no
client secret or authorization header is sent.

Integration cases exercise command import and transcript search, grouped participant sessions,
API occurrence ids, missing scopes, corrected/idempotent imports, time zones and daylight-saving
ambiguity. Temporary config and transcript fixtures live under `/tmp/zm-test-*`; they contain only
invented values and are retained until cleanup is approved.
