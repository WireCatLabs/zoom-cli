# @wirecat/zoom-cli

`zm` logs in to Zoom with your own public OAuth app and reads hosted meetings, participants,
transcripts and AI summaries. It archives available cloud recording video, audio, transcripts and
chat files. Downloaded WebVTT files can also be imported, including transcripts
from meetings you attended. The shared meeting model, ingestion and commands come from
`@wirecat/cli-meetings`.

## Current availability

Login, cloud recording downloads and remote meeting commands work independently of the meeting
database. Import, pull, folder watching and meeting reads use the published shared SQLite adapter.
Store connections open lazily and close before successful results are emitted. Meeting data persists
in the shared WireCat database; `MESSAGING_STORE` selects an explicit database path. The shared model,
exports and ingestion loop come from `@wirecat/cli-meetings`.

## Set up your Zoom app

Follow [the app guide](docs/zoom-app.md). Use Public Client OAuth and redirect to
`https://wirecat.dev/zoom-callback`. Configure the Public Client ID, then log in:

```sh
zm config set zoom.clientId <public-client-id>
zm login --browser firefox
```

The callback returns to a listener on your machine. If it cannot, paste the `code=…&state=…`
parameters shown on the callback page. Login checks the state and PKCE verifier, stores tokens
only in the system keyring, and returns login status and actual granted scopes. A missing keyring
is an error; tokens are never written to a config file.

## Commands

| Command | Purpose |
|---|---|
| `config show` | show local configuration |
| `config set <key> <value>` | configure the public client or file source |
| `login [--browser <program>]` | approve access through your browser |
| `commands --json` | discover command arguments, flags and examples |
| `complete -- <words...>` | answer shell completion requests |
| `doctor` | inspect local runtime and public config without login or database access |
| `session status` | inspect saved OAuth state separately from local data profiles |
| `import <folder>` | import downloaded transcripts into the selected local profile |
| `pull [--since <date>]` | fetch occurrences from the configured source |
| `meetings list`, `meetings show <meeting>` | read stored meetings |
| `meetings transcript <meeting>` | read current transcripts |
| `meetings summary <meeting>` | read stored summaries |
| `meetings export <meeting> --format markdown\|vtt` | export stored meeting content |
| `meetings search <query>`, `meetings people <query>` | find stored text or participants |
| `events list` | read stored events |
| `watch <folder> --jsonl` | repeatedly import a transcript folder in the foreground |
| `recordings list`, `recordings show <meeting>` | discover cloud recordings and asset metadata |
| `recordings download <meeting> --destination <directory>` | archive available recording files |
| `recordings sync --from <date> --to <date> --destination <directory> --jsonl` | archive recording history across calendar months |
| `recordings archive inspect\|verify\|locks <directory>` | inspect local manifests, checksums or locks |
| `recordings archive recover <directory>` | preview recovery of stale local locks |
| `remote-meetings list\|show\|invitation` | read upcoming Zoom meetings and invitations |
| `remote-meetings create\|update\|cancel` | preview or apply a simple Zoom meeting change |
| `serve --mcp` | serve read-only stored meeting tools over MCP stdio |
| `skill show`, `skill install --for agents` | print or explicitly install the packaged agent guide |

Use `--json` for one JSON value or `--jsonl` for one item per line. Errors go to stderr. `--no-input`
refuses browser login. `--help` and `--version` work without a configured app or login.
Use `--quiet` to suppress non-error diagnostics. Piped output defaults to JSON; terminal output
uses the shared human-readable renderer. Completion emits its shell protocol unless JSON is requested.

Browser login requires an input terminal. Piped or JSON login also requires
`--interactive`; CI and terminals without interactive input do not launch a browser. `session status` reads
cached login state without refreshing credentials. Remote verification through `session status
--check` explicitly contacts Zoom and requires the corresponding user-read scope.

Use `--fields id,title` to select result fields. `--offline` refuses network requests. Finite commands
buffer successful output until resource cleanup completes, with a default output limit of 4 MiB;
`--max-output-bytes 0` removes that limit. `--timeout <milliseconds>` sets a positive whole-command
deadline. Durations also accept units such as `30s`, `5m` and `1h`. Defaults are 30 seconds for reads,
five minutes for login and one hour for recording downloads, sync and archive verification.
Foreground watching and MCP serving have no default deadline. Cancellation waits for active operations
and cleanup; an injected operation that ignores its signal can delay shutdown.

Config keys: `zoom.clientId`, `account.profile`, `source` (`api` or `files`), `files.folder`,
and `files.timezone`.
Directories follow the platform convention; `ZM_CONFIG_DIR` overrides the configuration directory.
Changing that directory also changes the keyring service used for login.

## Select a local profile

Choose a label for the stored meetings:

```sh
zm config set account.profile personal
```

Labels contain 1–64 letters, digits, dots, underscores or hyphens and start with a letter or digit.
The label groups local meeting data; OAuth login uses the configured client and keyring entry. Use
separate labels for data you want kept in separate accounts. File import and API pull share the
selected profile. Folder import leaves its pull cursor unchanged; switching pull sources may need
an older explicit `--since` to revisit earlier occurrences.

Import and pull register the selected profile when ingestion begins. Read commands look up an
existing profile and never register an account; import transcripts or pull first if no stored
meetings exist. `MESSAGING_STORE` overrides the shared database path for all these commands and MCP
reads. Metadata, help, configuration and login commands do not open the database.

## Recover from errors

If the browser cannot start, select an installed browser with `--browser firefox`. In an interactive
terminal, you can also paste the callback parameters. Without paste input, a launch failure exits
promptly. A malformed config still allows `--help` and `--version`; config commands report the error.

Missing-scope errors name the required scope. Add it in your Zoom app, then log in again. A network
failure reports a provider error; malformed provider replies report an invalid response. Diagnostic
messages exclude raw provider error text.

Once persistence is connected, use `pull --lookback-days 7` to revisit the last seven days, or an
older explicit `pull --since 2026-10-01` for earlier occurrences whose transcript appeared later. The cursor alone does not guarantee
that late transcripts are revisited. Serialize pulls for the same account to avoid concurrent event
creation. A failed occurrence leaves the cursor unchanged so the next pull can retry it.

## Downloaded transcripts

The files source reads ordinary `.vtt` files directly inside a folder. Names follow the existing
exporter's `YYYY-MM-DD_HHMM_topic-slug.vtt` format. Occurrence ids derive from the timestamp and
normalized topic; files carry no Zoom occurrence UUID. Participants remain unknown, and speaker
names are kept without guessing an identity.

File times default to UTC. Set `files.timezone` to the IANA zone used when the filenames were
created, for example `Europe/Madrid`. Ambiguous or nonexistent daylight-saving times are refused. Conflicting contents for the same
normalized filename key are an error; correct the conflicting files before retrying. File discovery
fails explicitly on invalid names rather than silently importing a partial folder.

## Archive cloud recordings

Find an occurrence and download its available files to an explicit destination:

```sh
zm recordings list --from 2026-10-01 --to 2026-10-10 --json
zm recordings show example-occurrence --json
zm recordings download example-occurrence --destination ./zoom-archive --json
zm recordings archive verify ./zoom-archive --offline --json
```

For recording history across months, use:

```sh
zm recordings sync --from 2026-01-01 --to 2026-10-10 --destination ./zoom-archive --jsonl
```

Sync accepts explicit ordered dates spanning at most ten calendar years. It splits them into monthly
requests, deduplicates occurrence UUIDs and downloads serially. Each JSONL receipt describes one
completed occurrence; earlier receipts and completed files remain if a later request fails. Repeat the
same range or an overlapping recent range to discover new assets and skip verified files. Sync has no
durable date cursor; the requested range determines what is revisited. Headless sync requires `--jsonl`.

Recording lists accept an ordered date range of at most 31 days. Downloads stream to disk rather
than loading a video into memory. The default per-file limit is 20 GiB; change it with `--max-bytes`.
Use `--file-ids` to select comma-separated asset ids. Only completed, downloadable assets are saved;
the receipt reports unavailable assets separately. Zoom permissions, recording retention and account
features determine what can be downloaded. Assets from a meeting you attended are not necessarily
available through your cloud recording API.

Each occurrence has a manifest containing metadata, file sizes and SHA-256 checksums. Signed
download URLs and OAuth tokens are excluded. Repeating a download verifies existing manifest files
and skips matching assets. Existing files are never overwritten; a mismatch requires a new destination.
Interrupted downloads restart a file rather than using HTTP byte-range resume. Completed manifest
entries remain available if a later transfer fails.

Archive commands inspect and verify local data without logging in or opening a database. Concurrent
writers to the same destination are refused. After a process crash, inspect `recordings archive locks`
and preview `recordings archive recover`. Add `--yes` to remove recognized locks owned by a dead process
on this machine; active, foreign and unrecognized locks are preserved. Recovery removes stale lock
markers only. It does not repair an incomplete manifest or adopt an untracked file.

## Watch a transcript folder

```sh
zm watch ./downloaded-transcripts --interval 10s --jsonl
```

Watching rescans the folder for each cycle, so corrected older files are revisited. It imports serially,
closes the cycle's store connection before emitting its receipt and waits for output to drain before
starting another cycle. Intervals range from one second to one day. This is a foreground process;
stop it with Ctrl-C. Headless watching requires `--jsonl`; a stream cannot use `--json`.
The persistent connector is required, just as for a one-time import.

Cancellation allows up to one second to flush a fully completed receipt if it arrives during
store close. A blocked output pipe stops that flush; no later cycle starts.

## Read meeting tools through MCP

`zm serve --mcp` uses MCP's stdio protocol and serves seven read-only tools: meeting list/show,
transcripts, summaries, exports, text search and participant search. Tool discovery does not open a
database. Each read uses the selected local account and closes its connection before the response;
a caller cannot override the account. File exports and remote mutations are not exposed as tools.

MCP clients can launch `zm` with arguments `["serve", "--mcp"]`. Keep stdout for protocol messages;
omit `--json`, `--jsonl` and `--fields`. `--max-output-bytes` bounds each tool result, with zero meaning
unlimited. Actual reads require the compatible persistent connector; discovery is available before it.

`zm skill show` prints the packaged instructions for an agent. `zm skill install --for agents` writes
a version-stamped copy to the agent skills directory; `--for claude` selects Claude Code instead.
Installation is explicit and does not run when a command starts.

## Manage a Zoom meeting

Remote meeting ids are Zoom's numeric ids; stored `meetings` commands use local database ids.
Create, update and cancel show the proposed request by default. Add `--yes` to apply it once;
`--dry-run` always keeps the preview, including when `--yes` is present.

```sh
zm remote-meetings create --topic "Example planning" --start-time 2026-10-20T10:00:00Z --duration-minutes 30 --json
zm remote-meetings update 123456789 --topic "Example review" --yes --json
zm remote-meetings cancel 123456789 --dry-run --json
```

Only instant and scheduled creation and basic changes are supported. Remote writes are never
automatically retried. If a write was dispatched and its result is uncertain, inspect Zoom before
repeating it; the CLI reports an uncertain outcome with exit code 14.

## Development

Node 22.16 or newer within 22.x, or Node 24 or newer:

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check
pnpm build && pnpm smoke:bun
```

[Architecture](docs/dev/ARCHITECTURE.md), [testing](docs/dev/TESTING.md) and
[development setup](docs/dev/DEVELOPMENT.md) describe the local setup.
[Releasing](docs/dev/RELEASING.md) covers package checks and trusted publishing. Fixtures use invented
people and meetings. Tests use an injected keyring, scripted HTTP responses, temporary config
folders and the memory meeting store.

## Licence

[Apache License 2.0](LICENSE).
