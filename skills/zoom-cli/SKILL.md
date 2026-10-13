---
name: zoom-cli
description: Archive Zoom cloud recordings, read stored meeting transcripts and summaries, or manage a Zoom meeting through zm. Use for Zoom CLI workflows, not joining calls or operating the desktop video client.
metadata:
  version: "0.5.1"
---

# Zoom CLI

Use `zm commands <resource> --json` and `zm <resource> --help` for the installed version's capabilities.
Use JSON for finite reads and JSONL for foreground watches or batch synchronization. Keep diagnostics
on stderr; use `--fields` to limit returned content. `zm doctor --json` checks local setup without login.

## Recording archives

Use `recordings sync --since-time <date> --until-time <date> --destination <directory> --jsonl` to archive history
across months. It emits serial occurrence receipts and accepts up to ten calendar years.
Use `recordings list` to find cloud recording occurrences, then `recordings show <id-or-uuid>` to
inspect assets. Download with `recordings download <id-or-uuid> --destination <directory>`.
Prefer occurrence UUIDs for recurring meetings. Download access depends on Zoom scopes and the
signed-in account; attending a meeting does not imply access to its recording API.

Re-run against the same destination to skip verified manifest entries. Use `recordings archive check`
for local checksums; it works with `--offline`. The receipt distinguishes downloaded, skipped and
unavailable assets. A failed transfer can leave earlier completed files; retry starts the incomplete
file again. Existing files are never overwritten. Do not infer HTTP byte-range resume.

Read cues with `recordings archive transcript <directory>` or search their text with
`search meetings <query> --archive <directory> --limit 100`. Both work offline without configuration,
login or a database and verify each WebVTT file they read before returning results. Search can stop
before reading later files once it proves another match beyond the limit. Select `--uuid` or
comma-separated `--file-ids`; `--max-bytes` defaults to 8 MiB per file. Search is literal, normalized
and case-insensitive, with a maximum of 1000 matches. When `has_more` is true, increase the limit or
narrow the occurrence, file or query selection;
there is no continuation cursor. These reads do not import archive assets into the database.

Use `recordings archive import <directory> --offline --jsonl` to append verified VTT assets to the
selected local profile. It verifies the complete selection before opening the store; defaults are
8 MiB per file and 64 MiB total (`--max-total-bytes`). Appends are atomic per raw occurrence UUID,
retain corrected revisions and unrelated meeting data, and leave the pull cursor unchanged.
Unknown start times require an existing occurrence. Receipts acknowledge appends or report
unavailable occurrences; they do not imply creation or replay counts. Earlier acknowledgements
remain meaningful if a later occurrence fails.

`recordings archive locks` inspects writer locks. `recover` previews stale lock removal; `--yes`
removes recognized dead-process locks on this machine. It does not repair incomplete manifests or
adopt untracked files. Keep active and foreign locks intact.

## Stored meeting content

Stored `meetings` ids are local database ids, different from remote Zoom ids. Use `meetings show`,
`transcript`, `summary` and `search` for local reads. `transcript --history` includes retained versions.
Export Markdown or VTT with `meetings export <id> --format markdown|vtt`; file output requires an
explicit `--output` path and never overwrites an existing file. VTT export requires an unambiguous
current transcript or an explicit transcript id.

Store commands use the shared SQLite database; `MESSAGING_STORE` selects an explicit path. Select a
local profile before import or pull. Reads require existing profile data; they do not register it. `meetings sync --lookback-days` revisits late
transcripts. File imports preserve the API pull cursor. Serialize ingestion for the same account.
Local profile labels group stored data and do not select a different OAuth account.

`zm watch <folder> --jsonl` rescans legacy transcript files in the foreground; each cycle closes its
connection before emitting a receipt. Stop with Ctrl-C. Fully completed late receipts have at most
one second to flush; cancellation never starts another cycle. Hashed cloud archive VTT assets use
`recordings archive import`, separately from legacy folder import.

Use `zm watch --source api --lookback-days 7 --jsonl` for repeated online pulls that revisit late
transcripts. Without a folder or explicit source, watch uses the configured source; files can use
the configured folder. `--since-time` and `--lookback-days` apply only to API watching. Configuration is
captured before the first cycle, so restart to change profiles or source settings.
`--since-time` is the initial bound until a cursor write succeeds; later cycles use cursor plus overlap.
The selected overlap also subtracts from the initial bound.

`zm serve --mcp` provides seven read-only stored meeting tools. Discovery opens no database; reads
use the selected account. MCP uses its own framing, so omit JSON/JSONL/field-selection flags. `--meeting-context` adds three
read-only context tools; `--unified-search` adds one meetings-only shared search tool;
`--semantic --model <model>` lets `search_meetings` rank existing vectors with `by_meaning`. Remote model selection also requires
`--base-url` and `--dims`. The server fixes the model at startup and the profile on its first read.
Clients cannot select another model or account. Generation and task creation are not MCP tools.

The producer deletes legacy unencrypted `messages.db` and its SQLite sidecars on default-path
store open, without migration. Explicit paths and `MESSAGING_STORE` preserve them. A legacy
database held open by another process is kept until a later default-path open can delete it.

## Evidence, context and shared search

Use `meetings evidence meeting:<account>/<meeting>[/<transcript>[/<cue-position>]]` for bounded
stored evidence. Historical transcript references remain stable. Follow returned coverage and
continuation fields; use `--after` for a cue reference or `--after-transcript-id` for revision scans,
never both. Bound content with `--cues` and `--bytes`, and work with `--max-read-bytes` and
`--max-transcript-pages`. Do not treat a bounded page as complete history.

Use `meetings context person:<id>` for identity-linked context in the selected account. It does not
match speakers by name or prove that a linked participant spoke. Pending indexes and scan limits
can leave context incomplete. `meetings task-proposal <reference> --type question|request|mention|promise`
is read-only: `applied: false` and `persistence: "proposal-only"` do not mean a task was created.

`search all <query>` searches meetings by default. Broader `--only messages,mail,notes,meetings`
is explicit. Messages use the selected local account, mail includes stored email accounts, and
notes are store-global. Meetings use word prefixes; unsupported syntax or exact queries
are reported as skipped. Resume meetings-only results using the returned `meetings.next_cursor` as
`--meeting-cursor '<json>'`, bound to account and query. JSONL retains the entire report, including
coverage, skips and cursors.

## Explicit vector work

`meetings embeddings --model <installed-id>` previews existing chunk status without model loading
or writes. Add `--yes` only for explicitly requested generation: it validates and opens the model
before rebuilding and embedding one bounded batch. It never downloads local models. Remote
models require explicit `--base-url` and `--dims`; OpenAI uses `OPENAI_API_KEY`. Remote inference
is refused with `--offline`. Keep credentials out of endpoint URLs and output.

`--after-transcript-id` resumes chunk rebuilding; `--after-hash` resumes missing vectors. Current
revision hashes are rechecked before save. `search meetings <query> --model <model>` searches by
meaning: it first splits current transcripts again and embeds passages without a vector for that
model (with a remote model, those passages are sent to it), then ranks. Store filters do not apply.
Ranking covers scanned candidates, not all history. `--cursor` continues candidate scanning rather
than globally ranked pagination. The MCP `search_meetings` tool with `by_meaning` only reads
existing vectors. Index and archive completeness remain unknown. Use returned
candidate coverage and the explicit row/text byte bounds.

## Remote meeting changes

`remote-meetings` uses numeric Zoom meeting ids. Create, update and cancel preview by default;
`--yes` applies a change once, and `--dry-run` always previews. Follow the user's authorization for
actual mutations. Exit code 14 means a dispatched operation has an uncertain outcome: inspect remote
state before retrying. Do not automatically retry creation or cancellation.

## Authentication and execution

Missing-scope errors name the required scope; add it to the public OAuth app and log in again.
Browser login requires interactive input; `--interactive` permits piped/JSON login only when an input
terminal is present. `--no-input` cannot approve browser consent. Never extract or print keyring tokens.
Cached `session status` does not contact Zoom; `--check` explicitly verifies remotely.

Use `--timeout <milliseconds>` for a positive whole-command deadline and cancellation for foreground
jobs. `--offline` refuses network access. Recording videos stream to disk; ordinary result output is
bounded by `--max-output-bytes`, separate from the download's per-file `--max-bytes` limit.

## Bounded context-filtered search

Use `search meetings <query>` with `--since-time`/`--until-time` and optionally `--identity-id`, `--person-id`, `--event-id`, `--series-id`, `--project`, `--tag` or `--topic`. It indexes newly stored meetings before reading; there is no separate index step. Identity IDs come from observed participant results; person IDs follow explicit identity links. Filters select meetings, never attribute cue speech. Project names, keys and aliases resolve existing vocabulary and require confirmed membership; labels require explicit meeting taggings. Do not silently infer membership from matching words or merge similar participant names. Missing or ambiguous names fail. Inspect pending indexing and unknown archive coverage even for empty pages. `search_meetings` exposes the same selected-account MCP read.
