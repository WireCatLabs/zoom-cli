# Usage

Read a stored meeting, open its transcript and export the parts you need. This guide helps you
choose the right command and recognize whether it reads local data, contacts Zoom or changes
something. [Install and connect](installation.md) first if no meetings have been imported or pulled.

## Read your first meeting

```sh
zm meetings list --json
zm meetings show <meeting-id> --json
zm meetings transcript <meeting-id> --json
zm meetings summary <meeting-id> --json
```

Replace `<meeting-id>` with an ID from the list. Check the date and title before relying on its text.
A missing summary or transcript means that part was not supplied, not that nothing was discussed.
Stored reads use your selected local profile and do not fetch newer Zoom data. Use
[the archive guide](archive.md) to retrieve missing periods or import files.

To save a portable copy of the available content:

```sh
zm meetings export <meeting-id> --format markdown --json
```

Read the returned export before saving it to a file. MCP can return exports as text but does not
write files. [Search and evidence](search.md) keeps exact passage references when you need citations.

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
zm meetings prepare 123456789 --json
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
`other_sources: not-queried` visible.

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
`other_sources: not-queried` keeps imported documents, mail and messages outside this result's coverage.
Selecting `--json=notes.items.ref` keeps that coverage visible beside the references.

If the upcoming time appears without earlier calls, pull the relevant period through the Zoom API
so the store has its exact series links. Imported transcript files may not contain that provider
series ID. Preparation does not match calls by similar titles or participant names.

Coverage distinguishes missing stored history, undated occurrences, extra rows and output limits.
Archive completeness remains unknown. Imported documents, mail, messages and
project-name/alias candidates remain unqueried; without usable prior occurrences, related history
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
Notes have their own lookahead and output-limit flags, with at most twenty entries (or a smaller
`--context-limit`). They fit after accepted facts and meeting evidence. Additional rows may remain
when a bound is reached.
Skipped unavailable sources set `meta.complete=false`; inspect their references before relying on
the brief. Increase the relevant bound when the coverage identifies truncation.

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
| `meetings import <folder>` | import downloaded transcripts into the selected local profile |
| `meetings sync [--since-time <time>]` | fetch occurrences from the configured source |
| `meetings list`, `meetings show <meeting>` | read stored meetings |
| `meetings transcript <meeting>` | read current transcripts |
| `meetings summary <meeting>` | read stored summaries |
| `meetings export <meeting> --format markdown\|vtt` | export stored meeting content |
| `search meetings <query>`, `meetings people <query>` | find stored text, indexing new meetings first, or participants |
| `meetings prepare <series-id>` | gather upcoming proof and cited stored context for one selected series |
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
