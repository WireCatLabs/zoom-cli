# Usage

Read a stored meeting, open its transcript and export the parts you need. This guide helps you
choose the right command and recognize whether it reads local data, contacts Zoom or changes
something. [Install and connect](installation.md) first if no meetings have been imported or pulled.

## Read your first meeting

```sh
zm personal meetings list --json
zm personal meetings show <meeting-id> --json
zm personal meetings transcript <meeting-id> --json
zm personal meetings summary <meeting-id> --json
```

Replace `<meeting-id>` with an ID from the list. Check the date and title before relying on its text.
A missing summary or transcript means that part was not supplied, not that nothing was discussed.
Stored reads use your selected local profile and do not fetch newer Zoom data. Use
[the archive guide](archive.md) to retrieve missing periods or import files.

To save a portable copy of the available content:

```sh
zm personal meetings export <meeting-id> --format markdown --json
```

Read the returned export before saving it to a file. MCP can return exports as text but does not
write files. [Search and evidence](search.md) keeps exact passage references when you need citations.

## Find a scheduled meeting series

When you know the subject of the next call but not its Zoom series ID, ask your agent to find
candidate series first. This reads Zoom’s scheduled meetings for the connected account; it does
not import transcripts or open your local meeting database.

```text prompt
Find candidate series for my upcoming project meeting. Show the titles and series IDs, explain
any uncertain or old dates, then verify the next occurrence of the series I select before
preparing its context.
```

```sh
zm personal meetings scheduled --limit 20 --json
```

The answer keeps the selected account, titles, provider `meeting_id` values, an absolute search
window and coverage. By default that window starts now and ends seven days later. Zoom’s inventory
can include a recurring series with an old first-start date or no date. These are discovery hints:
they do not prove that a call happens in the window or that every calendar has been searched.
Keep `calendar_completeness: unknown` and `occurrence_proof: not-read` with the candidates.

If `item.page.has_more` is true, repeat the returned `item.after` and `item.until` as
`--since-time` and `--before-time`, together with `item.page.next_cursor` as `--cursor`.
The cursor belongs to that account and window; do not reuse it for another selection. Each call
reads one provider page, with up to 100 candidates and a default 64 KiB read/output budget. Use
`--max-read-bytes` and `--bytes` for explicit limits up to 1 MiB. A page that exceeds the limit is
refused rather than silently dropping candidate series. The command needs
`meeting:read:list_meetings` and network access; `--offline` refuses it before credentials are read.

Choose the provider series ID, then continue with [meeting preparation](#prepare-for-an-upcoming-meeting)
to verify the next occurrence and gather cited stored context. A local stored meeting ID is different.

## Prepare for an upcoming meeting

You have an upcoming Zoom call and want the relevant earlier discussion beside it. Ask your agent:

```text prompt
Prepare for the next Research Example planning call in Zoom. Identify the intended series first.
Show the upcoming time, cited passages from earlier calls, confirmed project links, saved decisions,
notes about earlier calls and linked people/projects, and directly sourced follow-up tasks. Show candidates if several
series fit. Tell me what is missing or uncertain. Do not change anything.
```

Use the provider series ID from [the Zoom schedule](remote-meetings.md), with digits and no spaces,
rather than the internal ID printed by `meetings list`. In a terminal:

```sh
zm personal meetings prepare 123456789 --json
```

This reads the selected series from Zoom and joins it to your selected local profile's stored
history. It needs the optional `meeting:read:meeting` permission in your
[Zoom app](zoom-app.md#add-archive-or-management-access). It does not pull missing transcripts,
change app permissions or start login. The default window looks seven days ahead and thirty days
back, including at most five prior occurrences, five related meetings and ten cited cues per meeting.

Check `item.upcoming.candidate` and `verified_next`: a candidate time can be useful without proving
it is the next occurrence. Recurring series dates alone never establish that claim. The result's
`meetings` hold meeting references, transcript cues and fingerprints, observed participant names
with existing person links, confirmed projects, accepted meeting facts and directly sourced tasks.
Past participants are not a prediction of who will attend next.

`related.items` adds stored meetings outside this series through existing person links or confirmed
project memberships shared with included history. Each has a meeting reference, cited cues and
`shared_person`/`shared_project` flags; `related.anchors` shows the prior calls used to establish
those connections. The search stays within this profile and history window, uses current links,
and excludes proposed project memberships. Matching names or transcript words never creates a link.

`knowledge.items` adds accepted facts about explicitly linked people and confirmed global projects,
including decisions recorded outside these meetings. Each has a `fact:` reference, subject/project
references, update time and `shared_person`/`shared_project` flags. It uses the included prior calls
as anchors and excludes proposed, reversed, deleted and later-updated facts. The fact reference lets
you retrieve the full record and evidence through Memo before relying on it. This section contains
accepted facts; `knowledge.coverage` keeps `fact_evidence: not-revalidated` and
`other_sources: not-queried` visible. When communications are explicitly requested,
`other_sources: see-communications` points to that separate source coverage instead.

`notes.items` adds owner-written notes and annotations about the included earlier calls, their
explicitly linked people and confirmed global projects. Each includes a `note:` reference,
title/text, revision, update time and a qualifying meeting/person/project reference. These are
saved comments, separate from accepted facts. The command uses current revisions and confirmed
associations. A meeting note must link to an included call in this profile; a shared project alone
does not bring in notes about other meetings. Deleted notes, bot-authored notes, account-scoped
person/project subjects and revisions updated after the preparation start are excluded. Retrieve
the referenced note in Memo when you need its full associations.

Check `notes.coverage.has_more` and `notes.coverage.output_limited` for additional or omitted notes.
`source_evidence: not-revalidated` means the note's supporting sources have not been checked;
`other_sources: not-queried` keeps imported documents, mail and messages outside this result's coverage
unless communications are explicitly requested. Then `other_sources: see-communications` points to
their separate coverage; these excerpts do not become owner-written notes.
Selecting `--json=notes.items.ref` keeps that coverage visible beside the references.

If you know which existing project to investigate, ask the agent to select it by its saved name,
key or alias. For example:

```text prompt
Prepare the next Research Example planning call. Also look for cited mentions of our existing
Research Example project and its saved aliases in earlier meetings from this profile. Keep word
matches separate from confirmed project links, and tell me where more results remain.
```

For a terminal request, add `--project`:

```sh
zm personal meetings prepare 123456789 --project RES --json
```

`project_evidence.pages` keeps each matched name or alias beside cited passages, offsets and source
meeting titles. It searches the same profile and history window, including calls with no project
link. A word match is a candidate to inspect; it does not establish that a meeting belongs to the
project. The same passage may match several names, which is not extra corroboration.

At most four search pages are included. An empty page can still lead to an alias with matches.
When `project_evidence.continuation` is present, use its project, frozen query, limit and read budget
with `meetings projects evidence`; pass its cursor when non-null. A null cursor means start without
`--cursor`. This continues the stored search without reading the upcoming Zoom schedule again.
Check pending indexing and unknown completeness even when the pages are empty. Changed vocabulary
or scope invalidates the cursor; restart the selected-project search instead of guessing a new cursor.

If the upcoming time appears without earlier calls, pull the relevant period through the Zoom API
so the store has its exact series links. Imported transcript files may not contain that provider
series ID. Preparation does not match calls by similar titles or participant names.

Coverage distinguishes missing stored history, undated occurrences, extra rows and output limits.
Archive completeness remains unknown. Documents, mail and messages remain unqueried unless you
explicitly request configured communications sources. Projects you did not select remain unqueried; without usable prior occurrences, related history
also remains unqueried. Stored fact evidence is not revalidated. Use
[search and evidence](search.md) to investigate those gaps. Preparation does not generate a summary,
record a decision, accept a finding or create a task.

For more control, use ISO timestamps with a zone for `--since-time`, `--before-time` and `--history-since-time`.
`--meetings` caps each of exact-series and related history separately; `--cues` and `--context-limit`
bound the context; `--max-read-bytes` bounds individual
reads and `--bytes` bounds the entire preparation item. Exact-series evidence takes priority;
`related.has_more` and `related.output_limited` identify extra or omitted related context.
Accepted knowledge has independent `knowledge.coverage.has_more` and `knowledge.coverage.output_limited` flags;
it returns at most twenty facts (or a smaller `--context-limit`) and yields bytes to meeting evidence.
Optional project-evidence pages yield bytes first, before notes, accepted knowledge and meeting evidence.
Each of their at most four pages makes one vocabulary read and one word read, each bounded by
`--max-read-bytes`; these limits do not bound database scan/sort work.
Notes have their own lookahead and output-limit flags, with at most twenty entries (or a smaller
`--context-limit`). They fit after accepted facts and meeting evidence. Additional rows may remain
when a bound is reached.
Skipped unavailable sources set `meta.complete=false`; inspect their references before relying on
the brief. Increase the relevant bound when the coverage identifies truncation.

## Include selected messages, mail and documents

First [select the source accounts or folders](configuration.md#select-communications-for-preparation).
Then ask your agent to include those sources:

```text prompt
Prepare the next Research Example planning call using the message, mail and document sources
I configured for this profile. Look for the word "launch". Keep each dated statement with its
source, preserve disagreements, and tell me which sources or indexes were incomplete.
```

For a terminal request, name each source explicitly and supply a literal word query:

```sh
zm personal meetings prepare 123456789 --context-source project-notes --context-query "launch" --json
```

Repeat `--context-source` for other configured IDs. The query takes up to sixteen literal words;
it does not run semantic search or infer a project. The default communications window covers the
fourteen days before the preparation start time. Set `--context-since-time` and
`--context-before-time` to ISO timestamps with a zone for a different window, at most ninety days
long and ending no later than the preparation start time. Undated rows are not searched.

`communications.items` contains at most twenty cited excerpts, shared fairly across sources.
Statements remain separate with their own dates and references: a later statement does not silently
replace an earlier one, and a matching word does not establish a project or person link.
`communications.coverage` retains the frozen query, window, source identities, index status,
undated-row notices, read usage and continuation even with JSON field projection. Inspect it when
there are no excerpts: an empty or limited result does not prove that nothing was discussed.

Each source reads one bounded page. If its coverage has `next_cursor`, repeat the same request with
`--context-source ID=CURSOR` for that source. Keep the query, window and source identity unchanged. Copy `coverage.window.after` and
`coverage.window.before` into explicit `--context-since-time` and `--context-before-time` flags
on continuation requests: a fresh default window uses the new current time and cannot replay the
old cursor.
If `restart_required` is true or a cursor is refused, restart without that source's cursor; do not
treat an omitted excerpt as read. Source failures and read limits are reported in coverage, with
`meta.complete=false` where applicable. Archive completeness remains unknown.

Communications share a 512 KiB, sixteen-dispatch read budget, bounded further by `--max-read-bytes`.
The output budget may remove excerpts while preserving coverage. Preparation opens an existing
compatible database read-only: it does not fill search indexes, migrate an old schema, import
missing records or save findings. Use the producing tool's import/index commands separately when
coverage identifies missing indexed data. A refused old schema needs a normal store upgrade before
preparation can read it.

## Choose local or remote data

| Need | Command family | Where it works |
|---|---|---|
| Read saved transcripts and evidence | `meetings`, `events`, `search` | Local shared database |
| Retrieve hosted meeting data | `meetings sync`, API `watch` | Zoom to local database |
| Import transcript files | `meetings import`, folder `watch` | Local files to database |
| Back up available recording assets | `recordings` | Zoom to the destination you name |
| Prepare one upcoming series with saved context | `meetings prepare` | Zoom schedule plus local database |
| Read the Zoom schedule or change a meeting | `remote-meetings` | Zoom account |

A successful local read does not prove Zoom still has the same content. A successful cloud download
does not import that transcript into the meeting database until you request archive import.

## Commands

| Command | Purpose |
|---|---|
| `config show` | show local configuration |
| `config set <key> <value>` | configure the public client or file source |
| `session start [--browser <program>]` | approve access through your browser |
| `commands --json` | discover command arguments, flags and examples |
| `complete -- <words...>` | answer shell completion requests |
| `doctor` | inspect local runtime and public config without login or database access |
| `session status` | inspect saved OAuth state separately from local data profiles |
| `meetings import <folder>` | import `.vtt` or zoom-searcher `.txt` transcripts into the selected local profile; names the zone file times were read in |
| `meetings sync [--since-time <time>]` | fetch occurrences from the configured source |
| `meetings list`, `meetings show <meeting>` | read stored meetings |
| `meetings transcript <meeting>` | read current transcripts |
| `meetings summary <meeting>` | read stored summaries |
| `meetings export <meeting> --format markdown\|vtt` | export stored meeting content |
| `search meetings <query>`, `meetings people <query>` | find stored text, indexing new meetings first, or participants |
| `meetings scheduled` | discover one bounded page of candidate series; dates remain unverified |
| `meetings prepare <series-id>` | gather upcoming proof and cited stored context for one selected series |
| `meetings projects scan <ref>` | suggest existing projects from a bounded stored meeting evidence page; no links saved |
| `meetings projects evidence <project> [query...]` | read bounded canonical-name/key/alias evidence for an existing project |
| `meetings update <reference>`, `meetings link <reference>` | preview or apply owner-selected stored links |
| `meetings transcribe <meeting> <file> --model <model>` | preview or locally recognize a WAV file into an independent transcript |
| `meetings passage <reference>`, `meetings evidence <reference>`, `meetings context <person>` | read bounded evidence or identity-linked person context |
| `meetings task-proposal <reference> --type <type>` | preview a task with meeting provenance |
| `search meetings <query> --model <model>` | rank stored passages by meaning, building missing vectors first |
| `meetings embeddings --model <model>` | preview vector generation ahead of a search; `--yes` applies one bounded batch |
| `search all <query>` | search meetings by default, or explicitly selected shared resources |
| `events list` | read stored events |
| `watch [api\|files] [folder] --jsonl` | repeatedly ingest from Zoom or a folder (default: configured source) in the foreground |
| `recordings list`, `recordings show <meeting>` | discover cloud recordings and asset metadata |
| `recordings download <meeting> --output-dir <dir>` | archive available recording files |
| `recordings sync --since-time <date> --until-time <date> --output-dir <dir> --jsonl` | archive recording history across calendar months |
| `recordings schedule create\|list\|show\|run\|disable` | plan and manage local daily archive jobs |
| `recordings archive show\|check\|locks <directory>` | inspect local manifests, checksums or locks |
| `recordings archive recover <directory>` | preview recovery of stale local locks |
| `recordings archive transcript <directory>` | read verified archived WebVTT cues without a database |
| `search recordings <directory> <query>` | search verified archived cue text without a database |
| `recordings archive import <directory>` | verify archived VTT assets and append them to stored occurrences |
| `remote-meetings list\|show\|invitation` | read upcoming Zoom meetings and invitations |
| `remote-meetings create\|update\|cancel` | preview or apply a simple Zoom meeting change |
| `serve --mcp` | serve read-only stored meeting tools over MCP stdio |
| `skill show`, `skill install --for agents` | print or explicitly install the packaged agent guide |

Stored `meetings` commands use local database ids; `remote-meetings` uses Zoom's numeric ids.
[Managing Zoom meetings](remote-meetings.md) covers the write commands.

## Output for scripts and agents

Use `--json` for one complete answer. A single result has `item`; a list has `items` and
`page` (`mode`, `limit`, `has_more`, optional `next_cursor`). Both carry `meta.run_id`,
`meta.duration_ms` and `meta.complete`,
with optional `next` steps and `missing` information. Result keys use snake_case.

Detailed reports, including participant discovery, evidence, semantic search and unified search,
keep their coverage and report-specific continuation inside `item`. Stored meeting word search
returns standard hit items with `ref`, `meeting`, `excerpt` and `offset_ms`. When stored, `source`
adds the meeting title, `started_at`, evidence `ref` and document `url`. A null URL means no source
permalink is stored; a meeting join link is not an evidence link. Meeting details use
`item`; transcripts and summaries use `items`. Details count current transcripts; use
`meetings transcript <meeting> --history` to read retained older revisions.

`--jsonl` emits typed records: each result is `{"type":"item","data":...}`, followed by an
`{"type":"end","complete":true,"page":...}` record. Empty lists still emit the end record.
Reports stay together inside one item record; each streaming acknowledgement has its own end record.
Read `complete` and optional `issues` on the end record. Use `--json` when you need the full
answer's `next`, `missing` and execution metadata. Command discovery is the shared contract-3
document with separate `effects.remote` and `effects.local` declarations; help, version and shell
completion retain their protocols.

A skipped source makes `meta.complete` false and adds a source issue. `search all` accepts partial
results and exits zero; inspect its skips before treating the result as complete. Other partial
answers exit with the first issue's error code after printing the available result. A bounded page
with more results is ordinary pagination, rather than a source failure.
Errors go to stderr. Use `--quiet`
to suppress non-error diagnostics. Piped output defaults to JSON; terminal output uses the shared
human-readable renderer. Completion emits its shell protocol unless JSON is requested.

Use `--json=id,title` to keep only those fields. Dotted paths select nested objects and arrays,
for example `--json=ref,excerpt,source.title,source.started_at,source.url` for meeting search hits.
Paths are relative to the answer payload; pagination, coverage, next steps, missing data and
execution metadata remain. Projection reduces printed output, not the work scanned.
`--offline` refuses network requests. Finite commands
buffer successful output until resource cleanup completes, with a default output limit of 4 MiB;
`--max-output-bytes 0` removes that limit.

## Deadlines and cancellation

`--timeout <milliseconds>` sets a positive whole-command deadline. Durations also accept units such
as `30s`, `5m` and `1h`. Defaults are 30 seconds for reads, five minutes for login and one hour for
recording downloads, sync and archive verification. Foreground watching and MCP serving have no
default deadline. Cancellation waits for active operations and cleanup; an injected operation that
ignores its signal can delay shutdown.
