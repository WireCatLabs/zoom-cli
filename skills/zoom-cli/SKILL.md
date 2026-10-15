---
name: zoom-cli
description: Archive Zoom cloud recordings, read stored meeting transcripts and summaries, or manage a Zoom meeting through zm. Use for Zoom CLI workflows, not joining calls or operating the desktop video client.
metadata:
  version: "0.14.0"
---

# Zoom CLI

Use `zm commands <resource> --json` and `zm <resource> --help` for the installed version's capabilities.
Use JSON for finite reads and JSONL for foreground watches or batch synchronization. Keep diagnostics
on stderr. Successful replies use `{item,meta}` or `{items,page,meta}` with snake_case keys.
Detailed reports (participants, evidence, semantic/unified search) live in `item`. Preserve
`meta.run_id`, `meta.duration_ms`, `meta.complete`, report coverage and continuation. JSON lists
use `page.mode` and optional `page.next_cursor`. JSONL emits typed item records with `data`,
then an end record with page/completeness. For reports, read the report inside the item record’s
`data`. Discovery uses contract 3 with separate local/remote effects.
Use `--json=id,title` to keep only those fields. `zm doctor --json` checks local setup without login.

## Recording archives

Use `recordings sync --since-time <date> --until-time <date> --output-dir <dir> --jsonl` to archive history
across months. It emits serial occurrence receipts and accepts up to ten calendar years.
Use `recordings list` to find cloud recording occurrences, then `recordings show <id-or-uuid>` to
inspect assets. Download with `recordings download <id-or-uuid> --output-dir <dir>`.
Prefer occurrence UUIDs for recurring meetings. Download access depends on Zoom scopes and the
signed-in account; attending a meeting does not imply access to its recording API.

Re-run against the same destination to skip verified manifest entries. Use `recordings archive check`
for local checksums; it works with `--offline`. The receipt distinguishes downloaded, skipped and
unavailable assets. A failed transfer can leave earlier completed files; retry starts the incomplete
file again. Existing files are never overwritten. Do not infer HTTP byte-range resume.

Read cues with `recordings archive transcript <directory>` or search their text with
`search recordings <directory> <query> --limit 100`. Both work offline without configuration,
login or a database and verify each WebVTT file they read before returning results. Search can stop
before reading later files once it proves another match beyond the limit. `recordings archive transcript`
selects with `--uuid` or comma-separated `--file-ids`; `--max-bytes` defaults to 8 MiB per file. Search is
literal, normalized and case-insensitive, with a maximum of 1000 matches, and answers `search all`'s hits.
When `page.has_more` is true, increase the limit or narrow the query;
there is no continuation cursor. These reads do not import archive assets into the database.

Use `recordings archive import <directory> --offline --jsonl` to append verified VTT assets to the
selected local profile. It verifies the complete selection before opening the store; defaults are
8 MiB per file and 64 MiB total (`--max-total-bytes`). Appends are atomic per raw occurrence UUID,
retain corrected revisions and unrelated meeting data, and leave the pull cursor unchanged.
Unknown start times require an existing occurrence. Receipts acknowledge appends or report
unavailable occurrences. The shared exact-receipt port reports `created`, `inserted_transcripts`,
`replayed_transcripts` and `superseded_transcripts`; legacy injected ports omit counts rather than guessing. Earlier acknowledgements
remain meaningful if a later occurrence fails.

`recordings archive locks` inspects writer locks. `recover` previews stale lock removal; `--yes`
removes recognized dead-process locks on this machine. It does not repair incomplete manifests or
adopt untracked files. Keep active and foreign locks intact.

## Stored meeting content

Stored `meetings` ids are local database ids, different from remote Zoom ids. Use `meetings show`,
`transcript`, `summary` and `search meetings` for local reads. `transcript --history` includes retained versions.
Export Markdown or VTT with `meetings export <id> --format markdown|vtt`; file output requires an
explicit `--output` path and never overwrites an existing file. VTT export requires an unambiguous
current transcript or an explicit transcript id.

Store commands use the shared SQLite database; `MESSAGING_STORE` selects an explicit path. Select a
local profile before import or pull. Reads require existing profile data; they do not register it. `meetings sync --lookback-days` revisits late
transcripts. File imports preserve the API pull cursor. Serialize ingestion for the same account.
Local profile labels group stored data and do not select a different OAuth account.

`zm watch files <folder> --jsonl` rescans legacy transcript files in the foreground; each cycle closes its
connection before emitting a receipt. Stop with Ctrl-C. Fully completed late receipts have at most
one second to flush; cancellation never starts another cycle. Hashed cloud archive VTT assets use
`recordings archive import`, separately from legacy folder import.

Use `zm watch api --lookback-days 7 --jsonl` for repeated online pulls that revisit late
transcripts. Without `api` or `files`, watch uses the configured source; `files` without a folder
uses the configured folder. `--since-time` and `--lookback-days` apply only to API watching. Configuration is
captured before the first cycle, so restart to change profiles or source settings.
`--since-time` is the initial bound until a cursor write succeeds; later cycles use cursor plus overlap.
The selected overlap also subtracts from the initial bound.

`zm serve --mcp` provides eight read-only stored meeting tools. Discovery opens no database; reads
use the selected account. MCP uses its own framing, so omit JSON/JSONL/field-selection flags. `--meeting-context` adds four
read-only context tools; `--meeting-preparation` adds the remote schedule plus cited-context
`meeting_prepare` tool; `--unified-search` adds one meetings-only shared search tool;
`--semantic --model <model>` lets `search_meetings` rank existing vectors with `by_meaning`. Remote model selection also requires
`--base-url` and `--dims`. The server fixes the model at startup and the profile on its first read.
Clients cannot select another model or account. Generation and task creation are not MCP tools.

The producer deletes legacy unencrypted `messages.db` and its SQLite sidecars on default-path
store open, without migration. Explicit paths and `MESSAGING_STORE` preserve them. A legacy
database held open by another process is kept until a later default-path open can delete it.

## Evidence, context and shared search

Transcript word-search hits include a retained cue `ref`. Use `meetings passage <ref> --before-n 3
--after-n 3 --format markdown` to inspect nearby lines, or `--json` for structured cues. Context has
explicit boundaries and byte clipping; inclusive `before_ref`/`after_ref` anchors overlap. Historical
revisions remain readable and are marked superseded. `meeting_passage` is available with the
MCP `--meeting-context` option; it cannot select another account.

Use `meetings evidence meeting:<account>/<meeting>[/<transcript>[/<cue-position>]]` for bounded
stored evidence. Historical transcript references remain stable. Follow returned coverage and
continuation fields; use `--cursor` for a cue reference or `--after-transcript-id` for revision scans,
never both. Bound content with `--cues` and `--bytes`, and work with `--max-read-bytes` and
`--max-transcript-pages`. Do not treat a bounded page as complete history.

Use `meetings context person:<id>` for identity-linked context in the selected account. It does not
match speakers by name or prove that a linked participant spoke. Pending indexes and scan limits
can leave context incomplete. `meetings task-proposal <reference> --type question|request|mention|promise`
is read-only: `applied: false` and `persistence: "proposal-only"` do not mean a task was created.

`search all <query>` searches meetings by default. Broader `--only messages,mail,notes,meetings`
is explicit. Messages use the selected local account, mail includes stored email accounts, and
notes are store-global. Meetings use word prefixes; unsupported syntax or exact queries
are reported as skipped. Resume meetings-only results using the returned `item.meetings.next_cursor` as
`--meeting-cursor '<json>'`, bound to account and query. JSONL retains the entire report inside one item record, including coverage, skips and cursors,
followed by an end record. Skipped sources add issues and set completeness false; search exits zero.

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

## Project-name evidence

Use `meetings projects evidence <project> [query...]` for one existing project's canonical name,
key and explicit aliases, including meetings without confirmed membership. Reuse the shared ID/date
query fields; the account comes from the selected profile. Each call reads one bounded name page
from the existing word index and does not refresh it. Keep the full item, coverage and root next
step even when hits is empty; replay its frozen query with the cursor. Word evidence is unconfirmed:
inspect cited passages before proposing associations. No project, alias, person or knowledge write.
MCP `meeting_project_evidence` has the same registered packet and strict account-fixed arguments.

## Participant discovery

Use `meetings people <name-or-email>` before selecting `--identity-id`. Reads inspect bounded
observations in the selected account; use `--limit`, `--scan-limit`, `--max-read-bytes` and `--cursor`.
Results expose `identity_id` with page-local ambiguity, not a proven person association. Follow
the report's `item.next` / `item.page.next_cursor` even when `item.items` is empty. JSONL retains the report and coverage inside its item record.
MCP `meeting_people` takes the equivalent snake_case arguments and cannot change accounts.

`meetings list [query...]` filters metadata, for example `started_at:[2026-09-01 TO 2026-10-01]`.
Use `--page` / `--limit` and retain the standard meeting/list envelope; IDs are strings.
List-only `--since-time` and `--until-time` have become query fields; transcript search keeps its date flags.

## Bounded context-filtered search

Use `search meetings <query>` with `--since-time`/`--until-time` and optionally `--identity-id`, `--person-id`, `--event-id`, `--series-id`, `--project`, `--tag` or `--topic`. It indexes newly stored meetings before reading; there is no separate index step. Identity IDs come from observed participant results; person IDs follow explicit identity links. Filters select meetings, never attribute cue speech. Project names, keys and aliases resolve existing vocabulary and require confirmed membership; labels require explicit meeting taggings. Do not silently infer membership from matching words or merge similar participant names. Missing or ambiguous names fail. Inspect pending indexing and unknown archive coverage even for empty pages. `search_meetings` exposes the same selected-account MCP read.

## Prepare one upcoming series

Use `meetings prepare <series-id> --json` with the exact provider series ID from remote meeting
listing, rather than an internal stored meeting ID. This reads Zoom's schedule and stored history,
requiring `meeting:read:meeting`; it does not start login, change scopes or import missing text.
Default windows look seven days ahead and thirty days back. Use ISO `--since-time`, `--before-time` and
`--history-since-time` for a fixed window; keep the returned absolute windows when replaying.

Preserve candidate/verified-next distinction and all meeting/cue references, fingerprints, stored
person links, confirmed project links, accepted facts and directly sourced tasks. Past attendees do
not establish future attendance. Coverage states live reads and unknown archive completeness, plus
unqueried person-history, project-wide context and project-alias candidates. Stored fact evidence
is not revalidated. Inspect skipped-source metadata and truncation before relying on the brief.
This command does not summarize, accept findings or create tasks. Use existing Memo workflows for
reviewed writes, retaining meeting evidence and preconditions.
