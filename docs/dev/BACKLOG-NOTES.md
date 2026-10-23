# Backlog notes

Evidence for items in [BACKLOG.md](BACKLOG.md) that does not fit on one line. Measured 2026-10-23 on `origin/main`
`393dc35` and on npm 0.36.0 installed into a throwaway HOME.

## ZM-1

`zm <command>` without a profile word stops with `name a profile: zm <profile> …` (verified: `zm session status --json`,
`zm search all plan --json`, `zm meetings passage … --json`, `zm stats meetings show --json` all return
`validation_error`). Profile-free commands (`commands`, `config`, `skill`, `doctor`, `guide`, `complete`, `upgrade`,
`models`) work. Affected help examples, shown under `Example:` in `--help` and in `commands --json`:
`meetings scheduled|projects scan|prepare|update|link|evidence|context|task-proposal|passage|embeddings`,
`session status`, `watch`, every `recordings …` and `remote-meetings …` leaf, `search all|meetings|recordings`,
`batch`. Sources: `src/archive-commands.ts`, `src/recording-schedule-commands.ts`, `src/meeting-context-commands.ts`,
`src/meeting-integration-commands.ts`, `src/watch-commands.ts:72`, `src/commands.ts:90`,
`src/ingestion-search-commands.ts:63`, `src/meeting-semantic-commands.ts:135`. Some examples come from cli-core's
meeting commands. Scenarios: `scenarios/catch-up.md`, `find-quote.md`, `person-in-meetings.md`, `prepare-meeting.md`,
`archive-recordings.md` (all `zm meetings …` / `zm recordings …`). A test that runs each example's first words
against the parser would keep it fixed.

## ZM-2

Verified: `zm personal mcp` in a fresh HOME answers `zm_tools_search "cancel remote meeting"` with
`remote-meetings cancel`, `writes: true`. docs/mcp.md:40-43 says this correctly. These say the opposite:

- docs/security.md:36 — "The MCP server is read-only and exposes no … remote mutations"
- docs/security.md:67 — "read-only MCP connection"
- README.md:328 — "The MCP server is read-only"
- docs/installation.md:162 — "its meeting tools are read-only"
- docs/index.md:31 — "Its MCP connection is read-only"
- docs/search.md:102 — "The read-only MCP tool `search_meetings`" (the tool no longer exists)

Options: make `remote-meetings` `readonly` over MCP unless the profile allows it (safer default for advertising),
or keep today's default and fix the six claims. The `zm_tools_search` description also gives messenger examples
("unread", "send message", "chat members"); that text comes from cli-core's shared MCP tools.

## ZM-3

zm has no built-in client id (`src/config.ts:72`, `client_id: null`). Installation needs a Zoom General app,
user-managed, with Public Client OAuth, the `https://wirecat.dev/zoom-callback` redirect and five scopes
(docs/installation.md:73-98, docs/zoom-app.md). An app in development works only for its creator's account
(docs/zoom-app.md:42-43, 73). Zoom's docs describe the ways to share an app with other accounts: Marketplace
publication after a functional and security review that checks scopes are the minimum needed
([app review process](https://developers.zoom.us/docs/distribute/app-review-process/),
[submit for review](https://developers.zoom.us/docs/distribute/app-submission/submit-apps-review/)), or a beta app
shared by link to a limited number of external users for a limited time, after Zoom approves the request. No note in
the private plans records a submission. The "Use a WireCat or team app" section (docs/zoom-app.md:36-46) and the
installation table row (docs/installation.md:78) read as if a WireCat app is available; none is published.

## ZM-8

`zm doctor --json` in a fresh HOME returns `version`, `runtime.node`, `config`, `profiles`,
`authentication.state: not_checked`, `database: not_checked`. docs/installation.md:44-47 says a headless server
without a keyring cannot save login; doctor is where a new user would look first.
