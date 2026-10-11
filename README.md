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
| `meetings evidence <reference>`, `meetings context <person>` | read bounded evidence or identity-linked person context |
| `meetings task-proposal <reference> --kind <kind>` | preview a task with meeting provenance |
| `meetings semantic <query> --model <id>` | rank scanned stored vectors with an explicit query model |
| `meetings embeddings --model <id>` | preview local vector generation; `--yes` applies one bounded batch |
| `search all <query>` | search meetings by default, or explicitly selected shared resources |
| `events list` | read stored events |
| `watch [folder] --source api\|files --jsonl` | repeatedly ingest the configured source in the foreground |
| `recordings list`, `recordings show <meeting>` | discover cloud recordings and asset metadata |
| `recordings download <meeting> --destination <directory>` | archive available recording files |
| `recordings sync --from <date> --to <date> --destination <directory> --jsonl` | archive recording history across calendar months |
| `recordings archive inspect\|verify\|locks <directory>` | inspect local manifests, checksums or locks |
| `recordings archive recover <directory>` | preview recovery of stale local locks |
| `recordings archive transcript <directory>` | read verified archived WebVTT cues without a database |
| `recordings archive search <directory> <query>` | search verified archived cue text without a database |
| `recordings archive import <directory>` | verify archived VTT assets and append them to stored occurrences |
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

The shared store uses `wirecat.db`. Opening its default path deletes the legacy unencrypted
`messages.db` and its `-wal` and `-shm` sidecars, without migrating them. The legacy files are kept
when `MESSAGING_STORE` is set, an explicit store path is supplied, or another process holds the
legacy database open. A later default-path open retries deletion after that process closes.

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

Cloud archive assets use hashed filenames and retain their identity in manifests. Use a separate
command to import these assets into the selected local profile:

```sh
zm recordings archive import ./zoom-archive --offline --jsonl
```

Import verifies every selected VTT asset before opening the store. The default limits are 8 MiB
per file and 64 MiB in total; use `--max-bytes` and `--max-total-bytes` to change them. Select an
occurrence with `--uuid`, or assets with comma-separated `--file-ids`. Each occurrence is appended
atomically by its raw Zoom UUID, preserving other transcripts, summaries, participants and the
pull cursor. Corrected content retains earlier revisions; identical asset hashes are idempotent.
An occurrence with no known start time can receive transcripts only if it already exists. Receipts
report acknowledged or unavailable occurrences; they do not distinguish creation from replay.
Earlier acknowledged occurrences can remain committed if a later append fails.

Read or search archived transcripts directly:

```sh
zm recordings archive transcript ./zoom-archive --offline --json
zm recordings archive search ./zoom-archive "example plan" --limit 100 --offline --json
```

Both commands verify each WebVTT file they read against manifest sizes and SHA-256 digests before
returning parsed cues. Search stops after finding one match beyond its limit; later files remain
unread. They need no login, configuration or database. Use `--uuid` or comma-separated
`--file-ids` to select assets, and `--max-bytes` to change the default 8 MiB per-file read limit.
Search matches literal cue text after Unicode normalization and lowercasing; speaker names are
not searched. Its default limit is 100, with a maximum of 1000. `hasMore` means another matching cue
exists; increase the limit or narrow the occurrence, file or query selection to read more.
Results have no continuation cursor. Finite output remains
bounded by `--max-output-bytes`, and a failed verification emits no successful result.

For repeated API ingestion, use `zm watch --source api --lookback-days 7 --jsonl`. A folder argument
selects file watching; otherwise the configured source applies. File watching can use `files.folder`.
API watching accepts `--since` and revisits zero through 31 days, and requires online access.
`--since` sets the initial lower bound; after a successful cursor write, later cycles use the cursor
with the selected overlap. Failed cycles retain the initial bound until a cursor write succeeds.
The overlap also subtracts from the initial `--since` bound.
`--interval` controls the delay between completed cycles. Profile, source and file settings are
captured, along with the OAuth client, before watching begins; changing configuration requires restarting the watch. Cycles never
overlap and close their store connection before emitting a receipt. Stop with Ctrl-C.

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

## Search and read evidence

`meetings search` keeps its existing literal transcript search. `search all` uses the shared search
service and searches only meetings by default:

```sh
zm search all "example plan" --limit 100 --max-meetings 100 --json
zm meetings evidence meeting:3/15/20/0 --cues 100 --bytes 65536 --json
zm meetings context person:7 --meetings 10 --scan-limit 1000 --json
zm meetings task-proposal meeting:3/15/20/0 --kind promise --json
```

Meeting references have the form `meeting:<account>/<meeting>[/<transcript>[/<cue-position>]]`.
They are restricted to the selected local account. Transcript references retain historical revision
identity. Evidence bounds both returned content and database reads; resume with its returned cue
reference using `--after`, or its revision cursor using `--after-transcript-id`. These continuation
options are mutually exclusive. `--max-read-bytes` defaults to 4 MiB per page and
`--max-transcript-pages` bounds revision scanning, including empty revisions. Follow the returned
continuation and completeness fields rather than assuming a bounded response is exhaustive.

Person context uses stored identity links and account presence, without matching speaker names.
A person linked to a meeting is not necessarily a speaker. Pending derived indexes or bounded scans
can leave context incomplete. Task proposals support question, request, mention and promise;
`applied: false` and `persistence: "proposal-only"` mean no task was created.

Broader search requires explicit `--only messages,mail,notes,meetings`. Selected message and mail
reads use the local account; notes are global to the shared store. Meeting matching uses word
prefixes; unsupported meeting syntax or exact queries are reported as skipped. A meetings-only
continuation uses the returned `meetings.nextCursor` as `--meeting-cursor '<json>'`, bound to its
account and query. JSONL emits one complete report, retaining skips, coverage and cursors.

## Explicit meeting vectors

Choose an already installed local model, or explicitly select a remote endpoint and dimensions:

```sh
zm meetings embeddings --model e5-small --json
zm meetings embeddings --model e5-small --yes --limit 100 --json
zm meetings semantic "example plan" --model e5-small --max-chunks 1000 --json
zm meetings semantic "example plan" --model example-model --base-url http://127.0.0.1:8080/v1 --dims 384 --json
```

The first embedding command previews existing chunk status without opening a model, downloading
files or generating vectors. `--yes` validates and opens the selected model before rebuilding chunks
and embedding one bounded batch. Local models must already be installed; this command never downloads
them. Remote endpoints are explicit; OpenAI endpoints use `OPENAI_API_KEY`. Remote models cannot be
used with `--offline`.

Generation uses current transcript revisions and rechecks their hashes before saving results.
`--after-transcript-id` continues rebuilding chunks; `--after-hash` continues missing-vector work.
These are separate cursors. Shared cached vectors remain available to other resources.

Semantic search embeds only the query and reads existing vectors; it never rebuilds or generates
stored vectors. Results rank scanned candidates for the selected account and model. Use
`--after-chunk-id` to continue candidate scanning, not to page through globally ranked results.
The report states candidate scan coverage; index completeness and archive completeness are unknown.
`--max-rows` and `--max-text-bytes` bound transcript reads for generation and search.

## Watch a transcript folder

```sh
zm watch ./downloaded-transcripts --interval 10s --jsonl
```

Watching rescans the folder for each cycle, so corrected older files are revisited. It imports serially,
closes the cycle's store connection before emitting its receipt and waits for output to drain before
starting another cycle. Intervals range from one second to one day. This is a foreground process;
stop it with Ctrl-C. Headless watching requires `--jsonl`; a stream cannot use `--json`.
Select a local profile before watching, just as for a one-time import.

Cancellation allows up to one second to flush a fully completed receipt if it arrives during
store close. A blocked output pipe stops that flush; no later cycle starts.

## Read meeting tools through MCP

`zm serve --mcp` uses MCP's stdio protocol and serves seven read-only tools: meeting list/show,
transcripts, summaries, exports, text search and participant search. Tool discovery does not open a
database. Each read uses the selected local account and closes its connection before the response;
a caller cannot override the account. File exports and remote mutations are not exposed as tools.

Optional flags add tools without changing the defaults: `--meeting-context` adds evidence, person
context and task proposals; `--unified-search` adds meetings-only shared search;
`--semantic --model <id>` adds one read-only vector query tool. Remote semantic models additionally
require `--base-url` and `--dims`. The server fixes the model at startup and the profile on its first
read; restart it to change either. Clients cannot override either selection. Embedding generation
and task creation are never MCP tools.

MCP clients can launch `zm` with arguments `["serve", "--mcp"]`. Keep stdout for protocol messages;
omit `--json`, `--jsonl` and `--fields`. `--max-output-bytes` bounds each tool result, with zero meaning
unlimited. Select a profile and import or pull its data before reading tools; discovery is available
without stored data.

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

[Commands](docs/commands.md), [architecture](docs/dev/ARCHITECTURE.md), [testing](docs/dev/TESTING.md) and
[development setup](docs/dev/DEVELOPMENT.md) describe the local setup.
[Releasing](docs/dev/RELEASING.md) covers package checks and trusted publishing. Fixtures use invented
people and meetings. Tests use an injected keyring, scripted HTTP responses, temporary config
folders and the memory meeting store.

`pnpm generate:check` checks the generated command reference. `pnpm test:matrix` measures CLI
command and option coverage; its [matrix](docs/dev/test-matrix.md) records explicit exceptions.

## Licence

[Apache License 2.0](LICENSE).
