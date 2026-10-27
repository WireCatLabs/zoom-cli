<!-- Generated from the command tree by scripts/commands.ts. Do not edit; run pnpm generate. -->

# Commands

Look up the exact command, arguments and options for reading meetings, archiving recordings or managing the Zoom schedule. Stored meeting IDs differ from remote Zoom IDs; archive destinations are explicit local directories. Start with installation or a task guide when connecting for the first time.

## Global options

These options apply to every command.

| Option | What it does |
|---|---|
| `-V, --version` | output the version number. |
| `-v, --verbose` | more detail in what is shown: -v ids, -vv everything we know. Default: `0`. |
| `--json` | machine-readable output: one JSON value on stdout; --json=id,text keeps only those fields. |
| `--jsonl` | machine-readable output: one JSON object per line, for streaming and jq. |
| `--quiet` | diagnostics off; a failure is still said. |
| `--trace` | the connection's own log lines on stderr — never content. |
| `--debug` | on a failure, its whole record — cause and stack — in place of the short line. |
| `--timeout <duration>` | give up on the whole command after this — 30s, 2m, 500ms. |
| `--offline` | answer from what was recorded and never connect; fails if nothing was. |
| `--no-input` | never prompt or open interactive login; piped input remains available. |
| `--max-input-bytes <bytes>` | maximum buffered input bytes (default: 16777216). |
| `--max-output-bytes <bytes>` | maximum machine output bytes (default: 4194304; 0 disables). |
| `--brief` | found items as reference, title, time, author and excerpt only. |
| `--full` | found items with their whole text and every provider field. |
| `--dry-run` | preview parsed arguments and permissions before running the action. |
| `--yes` | go ahead without the question an ask level puts before a write. |
| `--record` | keep this run, with the command as typed and secrets hidden; record_input false leaves the typed words out. |
| `--no-record` | do not keep it, whatever the configuration says. |

## `zm runs`

recorded runs — what this tool did, and when

### `zm runs list`

recorded runs, newest first

```sh
zm runs list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

| Option | What it does |
|---|---|
| `--limit <n>` | how many to show. Default: `20`. |
| `--page <n>` | which page, starting at 1. Default: `1`. |

**Returns:** run — run_id, command, started_at, status, cli_version, profile, completed_at, requests, and 20 more; every field: zm commands info runs list

**Example:** `zm runs list --limit 10`

### `zm runs show`

one run: what it was, how it ended, and every event it logged

```sh
zm runs show <run-id> [options]
```

| Argument | | What it is |
|---|---|---|
| `run-id` | required | an id from `zm runs list`. |

| Option | What it does |
|---|---|
| `--problems` | only failed responses, warnings and crashes. |

**Returns:** run details — run_id, command, started_at, status, cli_version, directory, event_count, events, and 19 more; every field: zm commands info runs show

**Example:** `zm runs show run-101`

### `zm runs path`

the directory holding one run

```sh
zm runs path <run-id>
```

| Argument | | What it is |
|---|---|---|
| `run-id` | required | an id from `zm runs list`. |

**Returns:** run location — path; every field: zm commands info runs path

**Example:** `zm runs path run-101`

## `zm config`

local Zoom configuration

### `zm config show`

show local configuration

```sh
zm config show
```

**Returns:** show local configuration

**Example:** `zm config show --json`

### `zm config set`

set a configuration value

**Changes local data.**

```sh
zm config set <key> <value>
```

| Argument | | What it is |
|---|---|---|
| `key` | required | setting name, such as zoom.client_id. |
| `value` | required | new value. |

**Returns:** set a configuration value

**Example:** `zm config set files.timezone Europe/Madrid --json`

### `zm config unset`

remove a setting, or a part of the file doctor reports a problem in

**Changes local data.**

```sh
zm config unset <key>
```

| Argument | | What it is |
|---|---|---|
| `key` | required | setting name, such as files.folder, or the key a doctor fix names. |

**Returns:** remove a setting, or a part of the file doctor reports a problem in

**Example:** `zm config unset files.folder`

## `zm meetings`

stored meetings and their records

### `zm meetings list`

stored meetings, newest first

```sh
zm meetings list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

| Option | What it does |
|---|---|
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |
| `--limit <n>` | meetings per page. Default: `100`. |
| `--page <n>` | page number. Default: `1`. |

**Returns:** meeting — ref, id, provider, account, title, url, started_at, ended_at, and 8 more; every field: zm commands info meetings list

**Next usually:** `zm meetings show <meeting>`, `zm meetings transcript <meeting>`, `zm meetings summary <meeting>`

**Example:** `zm personal meetings list --json`

### `zm meetings show`

show a stored meeting

```sh
zm meetings show <meeting> [options]
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | stored meeting id. |

| Option | What it does |
|---|---|
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |

**Returns:** meeting details — ref, id, provider, account, title, url, started_at, ended_at, and 16 more; every field: zm commands info meetings show

**Next usually:** `zm meetings transcript <meeting>`, `zm meetings summary <meeting>`, `zm recordings show <meeting>`

**Example:** `zm personal meetings show 1 --json`

### `zm meetings transcript`

show current meeting transcripts

```sh
zm meetings transcript <meeting> [options]
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | stored meeting id. |

| Option | What it does |
|---|---|
| `--history` | include superseded transcript versions. |
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |

**Returns:** meeting transcript — ref, meeting, source, language, superseded_at, created_at, lines; every field: zm commands info meetings transcript

**Example:** `zm personal meetings transcript 1 --json`

### `zm meetings summary`

show stored meeting summaries

```sh
zm meetings summary <meeting> [options]
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | stored meeting id. |

| Option | What it does |
|---|---|
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |

**Returns:** meeting summary — id, meeting, source, title, overview, sections, next_steps, content, and 3 more; every field: zm commands info meetings summary

**Next usually:** `zm meetings show <meeting>`, `zm meetings transcript <meeting>`, `zm recordings show <meeting>`

**Example:** `zm personal meetings summary 1 --json`

### `zm meetings export`

export a meeting as Markdown or one transcript as WebVTT

**Changes local data.**

```sh
zm meetings export <meeting> [options]
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | stored meeting id. |

| Option | What it does |
|---|---|
| `--format <format>` | export format. One of: `markdown`, `vtt`. Default: `markdown`. |
| `--transcript-id <id>` | export a specific transcript version. |
| `--output <file>` | write content to a file through the host's writer. |
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |

**Returns:** meeting export — meeting_id, format, filename, content, output; every field: zm commands info meetings export

**Example:** `zm personal meetings export 1 --format markdown --json`

### `zm meetings people`

find meeting participants by name or email

```sh
zm meetings people <query> [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | required | a name or an email address. |

| Option | What it does |
|---|---|
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |
| `--limit <n>` | most matching observations per page, 1–1000 (default 50). |
| `--scan-limit <n>` | most participant observations to inspect, 1–10000 (default 1000). |
| `--max-read-bytes <bytes>` | most stored name and email bytes to read (default 1048576). |
| `--cursor <cursor>` | continue with the same name query and selected account. |

**Returns:** meeting participants — schema_version, kind, account_id, query, items, ambiguity, coverage, page; every field: zm commands info meetings people

**Example:** `zm personal meetings people "Alice Example" --json`

### `zm meetings sync`

bring the stored meetings up to date from the connected account

**Changes local data.**

```sh
zm meetings sync [options]
```

| Option | What it does |
|---|---|
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |
| `--since-time <time>` | fetch meetings starting at or after this ISO 8601 date or time. |
| `--lookback-days <days>` | revisit recent occurrences for late transcripts (0–31). Default: `0`. |

**Returns:** meeting ingestion — meetings, participants, transcript_rows, summaries, warnings, timezone; every field: zm commands info meetings sync

**Example:** `zm personal meetings sync --dry-run --json`

### `zm meetings import`

import downloaded meeting transcripts

**Changes local data.**

```sh
zm meetings import <folder> [options]
```

| Argument | | What it is |
|---|---|---|
| `folder` | required | folder of transcripts downloaded from the provider. |

| Option | What it does |
|---|---|
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |

**Returns:** meeting ingestion — meetings, participants, transcript_rows, summaries, warnings, timezone; every field: zm commands info meetings import

**Example:** `zm personal meetings import ./downloaded-transcripts --json`

### `zm meetings scheduled`

discover candidate meeting series from one bounded provider page

```sh
zm meetings scheduled [options]
```

| Option | What it does |
|---|---|
| `--since-time <time>` | absolute window start as ISO timestamp with zone (default now). |
| `--before-time <time>` | exclusive ISO window end (default seven days after start). |
| `--limit <n>` | series candidates in one provider page, 1–100 (default 100). |
| `--max-read-bytes <bytes>` | normalized provider-page bytes, at most 1048576 (default 65536). |
| `--bytes <bytes>` | answer item UTF-8 JSON bytes, 2048–1048576 (default 65536). |
| `--cursor <cursor>` | continue with the same absolute window and returned page cursor. |

**Returns:** meeting series inventory — schema_version, kind, scope, after, until, items, page, fingerprint, and 2 more; every field: zm commands info meetings scheduled

**Example:** `zm personal meetings scheduled --dry-run --json`

### `zm meetings projects`

project-name evidence in stored meetings

#### `zm meetings projects evidence`

find cited project-name and alias evidence in the local meeting index; does not refresh it or confirm membership

```sh
zm meetings projects evidence <project> [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `project` | required | existing project name, key or explicit alias. |
| `query` | optional | exact ID fields and a UTC started_at range, joined by AND. |

| Option | What it does |
|---|---|
| `--limit <n>` | hits in one name page, 1 through 1000 (default 100). |
| `--cursor <cursor>` | continue with the same project and frozen selection from next. |
| `--max-read-bytes <bytes>` | word-read byte budget, at most 67108864 (default 4194304). |

**Returns:** meeting project evidence — schema_version, kind, account_id, query, project, term, hits, association, and 5 more; every field: zm commands info meetings projects evidence

**Example:** `zm personal meetings projects evidence RES "identity_id:12" --json`

#### `zm meetings projects scan`

suggest existing projects from one bounded page of stored meeting evidence

```sh
zm meetings projects scan <ref> [options]
```

| Argument | | What it is |
|---|---|---|
| `ref` | required | canonical parent meeting reference in the selected account. |

| Option | What it does |
|---|---|
| `--limit <n>` | existing project candidates, 1–10 (default 10). |
| `--cues <n>` | transcript cues, 1–100 (default 20). |
| `--bytes <bytes>` | answer item UTF-8 JSON bytes, 2048–65536 (default 16384). |
| `--max-read-bytes <bytes>` | stored text bytes per read, 1–65536 (default 65536). |
| `--cursor <cursor>` | continue from evidence.coverage.next_cursor with the same meeting. |

**Returns:** meeting project candidates — schema_version, kind, source, input_fingerprint, vocabulary_fingerprint, association, items, limits, and 2 more; every field: zm commands info meetings projects scan

**Example:** `zm personal meetings projects scan meeting:1/2 --json`

### `zm meetings prepare`

prepare cited context for one upcoming series

```sh
zm meetings prepare <series-id> [options]
```

| Argument | | What it is |
|---|---|---|
| `series-id` | required | exact provider series ID. |

| Option | What it does |
|---|---|
| `--context-source <id=cursor>` | authorized communications selection ID, optionally ID=cursor; repeat. Default: ``. |
| `--context-query <words>` | literal words to find within the selected communications. |
| `--context-since-time <time>` | communications window start as zoned ISO timestamp (default fourteen days before end). |
| `--context-before-time <time>` | exclusive communications end as zoned ISO timestamp (default preparation start). |
| `--project <project>` | include unconfirmed word evidence for one existing project name, key or alias. |
| `--since-time <time>` | window start as ISO timestamp with zone (default now). |
| `--before-time <time>` | exclusive window end as ISO timestamp (default seven days after start). |
| `--history-since-time <time>` | history start as ISO timestamp (default thirty days before start). |
| `--meetings <n>` | prior occurrences and separate related-meeting limit, 1–20 (default 5). |
| `--cues <n>` | cues per occurrence, 1–100 (default 10). |
| `--context-limit <n>` | entries per context category, 1–100 (default 20). |
| `--max-read-bytes <bytes>` | stored/normalized bytes per read, at most 4194304 (default 262144). |
| `--bytes <bytes>` | preparation item JSON bytes, 4096–4194304 (default 65536). |

**Returns:** meeting preparation — schema_version, kind, account_id, upcoming, series, history_window, meetings, related, and 6 more; every field: zm commands info meetings prepare

**Example:** `zm personal meetings prepare 123 --dry-run --json`

### `zm meetings update`

preview linking a stored meeting to an event; --yes applies it

**Changes local data.**

```sh
zm meetings update <reference> [options]
```

| Argument | | What it is |
|---|---|---|
| `reference` | required | meeting reference, such as meeting:1/1. |

| Option | What it does |
|---|---|
| `--event-id <id>` | stored event id, or none to unlink. |
| `--expected-event-id <id>` | compare current event id, or none. |
| `--yes` | apply this local change once. |
| `--dry-run` | preview even when --yes is present. |

**Returns:** meeting association — scope, account_id, meeting_id, change, applied, result; every field: zm commands info meetings update

**Example:** `zm personal meetings update meeting:1/1 --event-id 1 --json`

### `zm meetings link`

preview linking a meeting participant to a stored person; --yes applies it

**Changes local data.**

```sh
zm meetings link <reference> [options]
```

| Argument | | What it is |
|---|---|---|
| `reference` | required | meeting reference, such as meeting:1/1. |

| Option | What it does |
|---|---|
| `--participant-id <id>` | participant id from this meeting. |
| `--person <uid>` | explicit stored person UID. |
| `--source <accounts>` | explicit additional account ids authorized for target-person lookup. |
| `--expected-person <uid>` | compare current person UID, or none. |
| `--yes` | apply this local change once. |
| `--dry-run` | preview even when --yes is present. |

**Returns:** meeting association — scope, account_id, meeting_id, change, applied, result; every field: zm commands info meetings link

**Example:** `zm personal meetings link meeting:1/1 --participant-id 1 --person 1 --json`

### `zm meetings transcribe`

preview transcribing a recording on this machine; --yes adds the transcript

**Changes local data.**

```sh
zm meetings transcribe <meeting> <file> [options]
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | stored meeting id or meeting reference. |
| `file` | required | a recording: WAV as it is, MP4, M4A or other audio and video through an installed ffmpeg. |

| Option | What it does |
|---|---|
| `--model <model>` | installed speech model. |
| `--models-dir <dir>` | shared installed speech-model directory. |
| `--max-bytes <bytes>` | largest audio file to read, in bytes (default 1 GiB). |
| `--max-duration <duration>` | longest audio to transcribe (default 4h). |
| `--max-segments <n>` | most recognized segments (default 10000). |
| `--max-text-bytes <bytes>` | most transcript text, in bytes (default 4 MiB). |
| `--yes` | recognize locally and append to the existing meeting. |
| `--dry-run` | preview even when --yes is present. |

**Returns:** meeting transcription — applied, account_id, external_id, segments, media, meeting_id, created, inserted_transcripts, and 7 more; every field: zm commands info meetings transcribe

**Example:** `zm personal meetings transcribe meeting:3/12 ./AliceExample.m4a --model parakeet-v3 --json`

### `zm meetings evidence`

read the stored transcript lines, chat or summary behind a meeting reference

```sh
zm meetings evidence <reference> [options]
```

| Argument | | What it is |
|---|---|---|
| `reference` | required | meeting reference, such as meeting:3/15. |

| Option | What it does |
|---|---|
| `--cues <n>` | how many transcript lines, 1 through 1000. |
| `--bytes <bytes>` | how much text, in bytes, 2 through 4194304. |
| `--cursor <cursor>` | continue after this line reference from the previous page. |
| `--after-transcript-id <id>` | resume root-reference revision scan, including empty revisions. |
| `--max-read-bytes <bytes>` | most stored bytes to read per page (default 4 MiB). |
| `--max-transcript-pages <n>` | most transcript pages to read, 1 through 1000. |

**Returns:** meeting evidence — schema_version, kind, source, fingerprint, limits, content_bytes, coverage, items; every field: zm commands info meetings evidence

**Example:** `zm personal meetings evidence meeting:3/15 --json`

### `zm meetings context`

what the stored meetings say about a person, through linked identities

```sh
zm meetings context <person> [options]
```

| Argument | | What it is |
|---|---|---|
| `person` | required | stored person, such as person:7. |

| Option | What it does |
|---|---|
| `--cues <n>` | how many transcript lines, 1 through 1000. |
| `--bytes <bytes>` | how much text, in bytes, 2 through 4194304. |
| `--meetings <n>` | how many meetings, 1 through 100. |
| `--scan-limit <n>` | most identity links to look at, 1 through 1000. |
| `--since-time <time>` | only identity links since this ISO 8601 time. |

**Returns:** meeting person context — person, items, limits, content_bytes, coverage; every field: zm commands info meetings context

**Example:** `zm personal meetings context person:7 --meetings 10 --json`

### `zm meetings task-proposal`

preview the task a meeting line would become, without creating it

```sh
zm meetings task-proposal <reference> [options]
```

| Argument | | What it is |
|---|---|---|
| `reference` | required | transcript line reference, such as meeting:3/15/20/0. |

| Option | What it does |
|---|---|
| `--type <type>` | question, request, mention or promise. |

**Returns:** meeting task proposal — id, source, source_kind, group, account_id, kind, preview, revision, and 2 more; every field: zm commands info meetings task-proposal

**Example:** `zm personal meetings task-proposal meeting:3/15/20/0 --type promise --json`

### `zm meetings passage`

read a cited cue with bounded context before and after it

```sh
zm meetings passage <reference> [options]
```

| Argument | | What it is |
|---|---|---|
| `reference` | required | retained transcript cue reference from a search hit. |

| Option | What it does |
|---|---|
| `--before-n <n>` | preceding cues (default 3). |
| `--after-n <n>` | following cues (default 3); at most 999 surrounding cues in total. |
| `--bytes <bytes>` | cue JSON byte budget (default 65536); the anchor must fit. |
| `--max-read-bytes <bytes>` | stored text byte budget (default 4194304); boundary probes read metadata only. |
| `--expected-fingerprint <hash>` | reject a changed anchor using its previously read cue fingerprint. |
| `--format <format>` | compact text, Markdown or structured JSON. One of: `text`, `markdown`, `json`. Default: `text`. |

**Returns:** meeting passage — schema_version, kind, source, target_ref, target_fingerprint, fingerprint, revision, limits, and 3 more; every field: zm commands info meetings passage

**Example:** `zm personal meetings passage meeting:1/1/1/0 --json`

### `zm meetings embeddings`

preview building meeting vectors; --yes builds one batch

**Changes local data.**

```sh
zm meetings embeddings [options]
```

| Option | What it does |
|---|---|
| `--model <model>` | embedding model: an installed local one, or one served at --base-url. |
| `--base-url <url>` | remote embedding service; OpenAI reads OPENAI_API_KEY. |
| `--dims <n>` | vector size the remote service returns, in dimensions. |
| `--limit <n>` | how many results or items in one batch, 1 through 1000. |
| `--max-rows <n>` | most transcript lines to read, 1 through 100000. |
| `--max-text-bytes <bytes>` | most transcript text to read, in bytes (default 4 MiB). |
| `--after-transcript-id <id>` | continue splitting transcripts after this one. |
| `--after-hash <hash>` | continue embedding after this passage. |
| `--yes` | split transcripts and build their vectors; otherwise only preview. |

**Returns:** meeting embedding — account_id, model, status, applied, scope, rebuild_required, saved, skipped, and 3 more; every field: zm commands info meetings embeddings

**Example:** `zm personal meetings embeddings --model e5-small --json`

### `zm meetings status`

the last meeting ingestion pass: confirmed count, completion and checkpoint age

```sh
zm meetings status
```

**Returns:** sync progress — job, profile, done, total, remaining, state, updated_at, cursor_age_ms; every field: zm commands info meetings status

**Example:** `zm personal meetings status --json`

## `zm events`

the owner's stored events

### `zm events list`

list stored events

```sh
zm events list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | event id, origin or time fields that narrow the list. |

| Option | What it does |
|---|---|
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |

**Returns:** event — id, event_series_id, title, description, location, starts_at, ends_at, timezone, and 8 more; every field: zm commands info events list

**Example:** `zm personal events list --json`

## `zm commands`

every command by section; --json prints its contract, one path per call

### `zm commands info`

one command contract, or all schemas, error reasons and explicit overrides

```sh
zm commands info [path]
```

| Argument | | What it is |
|---|---|---|
| `path` | optional | one command path; without one, export schemas, error reasons and explicit overrides. |

**Returns:** one command contract, or all schemas, error reasons and explicit overrides

**Example:** `zm commands info commands`

## `zm store`

the shared local store every WireCat tool reads

### `zm store info`

the store file: where it is, its size, its schema against the one this tool speaks, which tools used it and how many rows it holds, by provider, chat kind, account, year (UTC) and attachment kind, over every account; changes nothing

```sh
zm store info
```

**Returns:** store info — path, exists, schema, opens, error, bytes, journal_mode, pages, and 12 more; every field: zm commands info store info

**Example:** `zm personal store info --json`

## `zm complete`

answer shell completion requests

```sh
zm complete [words]
```

| Argument | | What it is |
|---|---|---|
| `words` | optional | shell words ending in the partial word. |

**Returns:** answer shell completion requests

**Example:** `zm complete -- meetings s`

## `zm doctor`

check local runtime and public config without a login or database

```sh
zm doctor
```

**Returns:** check local runtime and public config without a login or database

**Example:** `zm doctor --json`

## `zm session`

the saved Zoom login, separate from local data profiles

### `zm session status`

show cached login state; remote verification is explicit

```sh
zm session status [options]
```

| Option | What it does |
|---|---|
| `--check` | verify the session with Zoom. |

**Returns:** show cached login state; remote verification is explicit

**Example:** `zm personal session status --json`, `zm personal session status --check --dry-run --json`

### `zm session start`

log in to Zoom through your browser

**Changes remote Zoom data.**

```sh
zm session start [options]
```

| Option | What it does |
|---|---|
| `--browser <program>` | browser program. |
| `--answer-stdin` | with --json and no terminal: print each question as a `needs` line on stderr and read its answer, one line, from stdin. |

**Returns:** log in to Zoom through your browser

**Example:** `zm personal session start`

## `zm upgrade`

upgrade zm with the package manager that installed it; --check only looks

**Changes local data.**

```sh
zm upgrade [options]
```

| Option | What it does |
|---|---|
| `--check` | say whether a newer version exists, and install nothing. |

**Returns:** upgrade zm with the package manager that installed it; --check only looks

**Example:** `zm upgrade --check`

## `zm models`

models that run on this machine

### `zm models list`

speech and embedding models, their download status and the default of each kind

```sh
zm models list [query]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

**Returns:** model — id, kind, title, languages, size_bytes, downloaded, default, path, and 1 more; every field: zm commands info models list

**Next usually:** `zm models download <model>`

**Example:** `zm models list`, `zm models list kind:audio`

### `zm models download`

download and verify one speech or embedding model

**Changes local data.**

```sh
zm models download <model> [options]
```

| Argument | | What it is |
|---|---|---|
| `model` | required | a model id from models list. |

| Option | What it does |
|---|---|
| `--offline` | refuse a download that needs the network. |
| `--accept-terms` | accept the model's licence terms, for a model that has its own. |

**Returns:** model — id, kind, title, languages, size_bytes, downloaded, default, path, and 1 more; every field: zm commands info models download

**Example:** `zm models download parakeet-v3`

## `zm watch`

keep fetching new meetings from Zoom, or rescanning a folder, until stopped

**Changes local data.**

```sh
zm watch [target] [folder] [options]
```

| Argument | | What it is |
|---|---|---|
| `target` | optional | api or files; otherwise the configured source. One of: `api`, `files`. |
| `folder` | optional | with files: folder of downloaded transcripts; otherwise files.folder. |

| Option | What it does |
|---|---|
| `--since-time <time>` | on the first run, fetch meetings from this ISO 8601 time. |
| `--lookback-days <days>` | API cursor overlap for late transcripts (0 through 31). |
| `--pause <duration>` | delay after each completed receipt (1s through 24h). Default: `10000`. |

**Returns:** meeting ingestion — meetings, participants, transcript_rows, summaries, warnings, timezone; every field: zm commands info watch

**Example:** `zm personal watch files ./downloads --pause 10s --jsonl`, `zm personal watch api --lookback-days 2 --dry-run --jsonl`

## `zm recordings`

cloud recording assets and verified local archives

### `zm recordings list`

list cloud recording occurrences (last 30 days by default)

```sh
zm recordings list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms; this list filters by none yet. |

| Option | What it does |
|---|---|
| `--since-time <time>` | first day, YYYY-MM-DD. |
| `--until-time <time>` | last day, YYYY-MM-DD (default today in --timezone). |
| `--timezone <zone>` | IANA timezone of today (default the computer's). |

**Returns:** zoom recording — id, uuid, title, started_at, assets; every field: zm commands info recordings list

**Example:** `zm personal recordings list --since-time 2026-10-01 --until-time 2026-10-10 --dry-run --json`

### `zm recordings show`

show downloadable asset metadata without signed URLs

```sh
zm recordings show <meeting>
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | meeting id or occurrence UUID. |

**Returns:** zoom recording — id, uuid, title, started_at, assets; every field: zm commands info recordings show

**Example:** `zm personal recordings show example-occurrence --dry-run --json`

### `zm recordings download`

download one recording or a date range into a verified, resumable archive

**Changes local data.**

```sh
zm recordings download [meeting] [options]
```

| Argument | | What it is |
|---|---|---|
| `meeting` | optional | meeting id or occurrence UUID; omit when downloading a date range. |

| Option | What it does |
|---|---|
| `--output-dir <dir>` | explicit archive directory. |
| `--since-time <time>` | first day of a date range, YYYY-MM-DD. |
| `--until-time <time>` | last day of a date range, YYYY-MM-DD; at most ten years after the first. |
| `--file-ids <ids>` | comma-separated recording file ids; only with a meeting. |
| `--max-bytes <bytes>` | per-file download byte limit (default 20 GiB). |
| `--resume` | resume verified partial downloads and archive progress; requires a local profile. |
| `--no-resume` | disable persistent resume state for this invocation. |
| `--checkpoint <file>` | date-range checkpoint file; implies resume. |
| `--recheck-since-time <time>` | look again from this day for late recordings in a date range. |
| `--max-pages <pages>` | date-range catalog page limit from 1 through 10000 (default 1000). |
| `--max-entries <n>` | date-range occurrence limit from 1 through 10000 (default 10000). |

**Returns:** zoom archive — uuid, manifest_path, downloaded, skipped, unavailable, window, meeting, archive, and 2 more; every field: zm commands info recordings download

**Example:** `zm personal recordings download example-occurrence --output-dir ./zoom-archive --dry-run --json`, `zm personal recordings download --since-time 2026-01-01 --until-time 2026-10-10 --output-dir ./zoom-archive --dry-run --jsonl`

### `zm recordings archive`

inspect archives without Zoom or a database

#### `zm recordings archive transcript`

read the transcripts of a local archive, checking each file first

```sh
zm recordings archive transcript <directory> [options]
```

| Argument | | What it is |
|---|---|---|
| `directory` | required | archive folder. |

| Option | What it does |
|---|---|
| `--uuid <uuid>` | select an occurrence UUID. |
| `--file-ids <ids>` | select comma-separated transcript asset ids. |
| `--max-bytes <bytes>` | largest transcript file to read, in bytes (default 8 MiB). |

**Returns:** zoom archive transcript — meeting, asset, cues; every field: zm commands info recordings archive transcript

**Example:** `zm personal recordings archive transcript ./zoom-archive --uuid example-occurrence --json`

#### `zm recordings archive show`

show what a local archive holds, from its transfer records

```sh
zm recordings archive show <directory>
```

| Argument | | What it is |
|---|---|---|
| `directory` | required | archive folder. |

**Returns:** zoom archive manifest — version, meeting, files; every field: zm commands info recordings archive show

**Example:** `zm personal recordings archive show ./zoom-archive --json`

#### `zm recordings archive check`

check the size and checksum of every file in a local archive

```sh
zm recordings archive check <directory>
```

| Argument | | What it is |
|---|---|---|
| `directory` | required | archive folder. |

**Returns:** zoom archive check — manifest_path, id, path, valid; every field: zm commands info recordings archive check

**Example:** `zm personal recordings archive check ./zoom-archive --json`

#### `zm recordings archive locks`

list the locks on a local archive: active, stale or another machine's

```sh
zm recordings archive locks <directory>
```

| Argument | | What it is |
|---|---|---|
| `directory` | required | archive folder. |

**Returns:** zoom archive lock — name, status, pid, host; every field: zm commands info recordings archive locks

**Example:** `zm personal recordings archive locks ./zoom-archive --json`

#### `zm recordings archive recover`

preview removing stale locks; --yes removes them

**Changes local data.**

```sh
zm recordings archive recover <directory> [options]
```

| Argument | | What it is |
|---|---|---|
| `directory` | required | archive folder. |

| Option | What it does |
|---|---|
| `--yes` | remove recognized locks left by a dead local process. |
| `--dry-run` | preview only, including when --yes is present. |

**Returns:** zoom archive recovery — locks, removed; every field: zm commands info recordings archive recover

**Example:** `zm personal recordings archive recover ./zoom-archive --dry-run --json`

#### `zm recordings archive import`

check an archive's transcripts, then add them to the stored meetings

**Changes local data.**

```sh
zm recordings archive import <directory> [options]
```

| Argument | | What it is |
|---|---|---|
| `directory` | required | archive folder. |

| Option | What it does |
|---|---|
| `--uuid <uuid>` | select an occurrence UUID. |
| `--file-ids <ids>` | select comma-separated transcript asset ids. |
| `--max-bytes <bytes>` | largest transcript file, in bytes (default 8 MiB). |
| `--max-total-bytes <bytes>` | most transcript bytes in all, checked before any write (default 64 MiB). |

**Returns:** zoom archive import — uuid, asset_ids, status, meeting_id, created, inserted_transcripts, replayed_transcripts, superseded_transcripts, and 1 more; every field: zm commands info recordings archive import

**Example:** `zm personal recordings archive import ./archive --jsonl`

### `zm recordings schedule`

local archive jobs and Linux user systemd timers

#### `zm recordings schedule create`

preview a daily archive job; --yes installs its timer

**Changes local data.**

```sh
zm recordings schedule create [options]
```

| Option | What it does |
|---|---|
| `--name <name>` | local job name. |
| `--output-dir <dir>` | absolute archive directory. |
| `--since-time <time>` | first day to archive, YYYY-MM-DD. |
| `--at <hh:mm>` | daily time. |
| `--timezone <zone>` | IANA timezone for the timer. |
| `--lookback-days <days>` | revisit the latest zero through 31 UTC days (default seven). |
| `--max-bytes <bytes>` | maximum bytes per recording file (default 20 GiB). |
| `--yes` | install and enable the captured timer. |
| `--dry-run` | preview even when --yes is present. |

**Returns:** zoom archive schedule change — applied, backend, job, timer_state, units; every field: zm commands info recordings schedule create

**Example:** `zm personal recordings schedule create --name daily --output-dir /home/AliceExample/archive --since-time 2026-01-01 --at 03:15 --timezone UTC --json`

#### `zm recordings schedule list`

list saved local jobs; live timer state is not checked

```sh
zm recordings schedule list [query]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms; this list filters by none yet. |

**Returns:** zoom archive job — version, schedule, capture, state; every field: zm commands info recordings schedule list

**Example:** `zm personal recordings schedule list --offline --json`

#### `zm recordings schedule show`

show one saved local job and its captured settings

```sh
zm recordings schedule show <job>
```

| Argument | | What it is |
|---|---|---|
| `job` | required | saved job id. |

**Returns:** zoom archive job — version, schedule, capture, state; every field: zm commands info recordings schedule show

**Example:** `zm personal recordings schedule show example-job --offline --json`

#### `zm recordings schedule run`

run the captured job once with durable archive progress

**Changes local data.**

```sh
zm recordings schedule run <job>
```

| Argument | | What it is |
|---|---|---|
| `job` | required | saved job id. |

**Returns:** zoom archive receipt — window, meeting, archive, availability, checkpoint_revision; every field: zm commands info recordings schedule run

**Example:** `zm personal recordings schedule run example-job --dry-run --jsonl`

#### `zm recordings schedule disable`

preview disabling a saved timer; --yes disables it without deleting files

**Changes local data.**

```sh
zm recordings schedule disable <job> [options]
```

| Argument | | What it is |
|---|---|---|
| `job` | required | saved job id. |

| Option | What it does |
|---|---|
| `--yes` | disable and stop the timer. |
| `--dry-run` | preview even when --yes is present. |

**Returns:** zoom archive schedule change — applied, backend, job, timer_state, units; every field: zm commands info recordings schedule disable

**Example:** `zm personal recordings schedule disable example-job --json`

### `zm recordings status`

confirmed archived assets and pending discovery in one archive checkpoint

```sh
zm recordings status <directory> [options]
```

| Argument | | What it is |
|---|---|---|
| `directory` | required | archive folder. |

| Option | What it does |
|---|---|
| `--checkpoint <file>` | an explicit archive checkpoint path. |

**Returns:** sync progress — job, profile, done, total, remaining, state, updated_at, cursor_age_ms; every field: zm commands info recordings status

**Example:** `zm personal recordings status ./zoom-archive --json`

## `zm remote-meetings`

upcoming Zoom meetings; stored meeting reads remain under meetings

### `zm remote-meetings list`

list upcoming meetings

```sh
zm remote-meetings list [query]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms; this list filters by none yet. |

**Returns:** zoom remote meeting — id, uuid, title, type, started_at, duration_minutes, timezone, agenda, and 1 more; every field: zm commands info remote-meetings list

**Example:** `zm personal remote-meetings list --dry-run --json`

### `zm remote-meetings show`

show an upcoming meeting

```sh
zm remote-meetings show <meeting>
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | positive numeric Zoom meeting id. |

**Returns:** zoom remote meeting — id, uuid, title, type, started_at, duration_minutes, timezone, agenda, and 1 more; every field: zm commands info remote-meetings show

**Example:** `zm personal remote-meetings show 123456789 --dry-run --json`

### `zm remote-meetings invitation`

read invitation text

```sh
zm remote-meetings invitation <meeting>
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | positive numeric Zoom meeting id. |

**Returns:** zoom remote invitation — id, invitation; every field: zm commands info remote-meetings invitation

**Example:** `zm personal remote-meetings invitation 123456789 --dry-run --json`

### `zm remote-meetings create`

create a Zoom meeting; asks first, --dry-run previews

**Changes remote Zoom data.**

```sh
zm remote-meetings create [options]
```

| Option | What it does |
|---|---|
| `--title <title>` | meeting title. |
| `--start-time <time>` | ISO start time with timezone. |
| `--duration-minutes <minutes>` | positive meeting duration in minutes. |
| `--timezone <zone>` | IANA timezone. |
| `--agenda <text>` | meeting agenda. |
| `--type <type>` | instant (1) or scheduled (2). |
| `--yes` | apply the change without asking first. |
| `--dry-run` | preview only, including when --yes is present. |

**Returns:** zoom remote change — action, applied, request, meeting; every field: zm commands info remote-meetings create

**Example:** `zm personal remote-meetings create --title "Example planning" --start-time 2026-10-10T15:30:00Z --dry-run --json`

### `zm remote-meetings update`

change a Zoom meeting; asks first, --dry-run previews

**Changes remote Zoom data.**

```sh
zm remote-meetings update <meeting> [options]
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | positive numeric Zoom meeting id. |

| Option | What it does |
|---|---|
| `--title <title>` | meeting title. |
| `--start-time <time>` | ISO start time with timezone. |
| `--duration-minutes <minutes>` | positive meeting duration in minutes. |
| `--timezone <zone>` | IANA timezone. |
| `--agenda <text>` | meeting agenda. |
| `--type <type>` | instant (1) or scheduled (2). |
| `--yes` | apply the change without asking first. |
| `--dry-run` | preview only, including when --yes is present. |

**Returns:** zoom remote change — action, applied, request, meeting; every field: zm commands info remote-meetings update

**Example:** `zm personal remote-meetings update 123456789 --title "Example planning" --dry-run --json`

### `zm remote-meetings cancel`

cancel a Zoom meeting; asks first, --dry-run previews

**Changes remote Zoom data.**

```sh
zm remote-meetings cancel <meeting> [options]
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | positive numeric Zoom meeting id. |

| Option | What it does |
|---|---|
| `--occurrence-id <id>` | cancel one recurring occurrence. |
| `--yes` | cancel without asking first. |
| `--dry-run` | preview only, including when --yes is present. |

**Returns:** zoom remote change — action, applied, request, meeting; every field: zm commands info remote-meetings cancel

**Example:** `zm personal remote-meetings cancel 123456789 --dry-run --json`

## `zm contacts`

your Zoom contacts, read live: company colleagues and external contacts

### `zm contacts list`

list your company and external Zoom contacts

```sh
zm contacts list [query]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

**Returns:** contact — ref, id, name, username, description, last_messaged_at, alias, display_name, and 4 more; every field: zm commands info contacts list

**Next usually:** `zm meetings context <person>`

**Example:** `zm personal contacts list --json`, `zm personal contacts list type:external name:alice`

### `zm contacts show`

one contact with their phone numbers

```sh
zm contacts show <contact>
```

| Argument | | What it is |
|---|---|---|
| `contact` | required | their member id from `contacts list`, Zoom user id or email. |

**Returns:** contact — ref, id, name, username, description, last_messaged_at, alias, display_name, and 4 more; every field: zm commands info contacts show

**Next usually:** `zm meetings context <person>`

**Example:** `zm personal contacts show alice@example.com --json`

## `zm zoom`

Zoom's own live search: chat, docs and meetings zm does not archive

### `zm zoom search`

search your Zoom workspace live; without words, list recent records

```sh
zm zoom search [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | words Zoom matches in the content; it does not widen word forms. |

| Option | What it does |
|---|---|
| `--only <resources>` | comma list of meetings, calendar, chat, channels, docs, notes, calls, sms, voicemail (default Zoom's own choice). |
| `--limit <n>` | Zoom results per resource, 1 through 100 (default 10); one chat result holds its matching messages. |
| `--cursor <cursor>` | continue from the previous page's page.next_cursor, with the same query and --only. |

**Returns:** zoom search hit — source, id, title, time, text, url, people, container_id, and 1 more; every field: zm commands info zoom search

**Example:** `zm personal zoom search "budget" --only chat,docs --json`, `zm personal zoom search --only meetings --limit 50`

## `zm skill`

the instructions an agent is given for this tool

### `zm skill show`

print SKILL.md — `zm skill install` puts it where Claude Code, Codex, Gemini CLI and OpenClaw look for it, and where Hermes does on request; --for prints the copy already there

```sh
zm skill show [options]
```

| Option | What it does |
|---|---|
| `--for <agents>` | print the copy installed for these agents instead of this version's. One of: `claude`, `agents`. |

**Returns:** print the tool's instructions for AI agents

**Example:** `zm skill show --json`

### `zm skill install`

write SKILL.md to \~/.claude/skills/zoom-cli/ (Claude Code) and \~/.agents/skills/zoom-cli/ (Codex, Gemini CLI, OpenClaw); --for hermes also has Hermes read \~/.agents/skills, which changes Hermes's own settings, so all leaves it out

**Changes local data.**

```sh
zm skill install [options]
```

| Option | What it does |
|---|---|
| `--for <agents>` | which agents to install for. One of: `claude`, `agents`, `hermes`, `all`. Default: `all`. |

**Returns:** install the tool's instructions for AI agents

**Example:** `zm skill install --for agents --json`

### `zm skill status`

for each place `zm skill install` writes to, and for the copy Hermes reads: the path, the version installed there, and whether it is current, stale, missing or unversioned

```sh
zm skill status
```

**Returns:** whether the installed instructions for AI agents match this version

**Example:** `zm skill status`, `zm skill status --json`

## `zm mcp`

serve zm's commands to an agent over MCP — `claude mcp add zm -- zm <profile> mcp serve`

### `zm mcp serve`

serve this profile to an agent over MCP, on stdin and stdout — `claude mcp add zm -- zm <profile> mcp serve`; with no profile, `zm mcp serve` serves every profile and each tool asks which

**Changes local data.**

```sh
zm mcp serve
```

**Returns:** serve this profile's commands to an AI agent

**Example:** `zm personal mcp serve`

## `zm search`

opt-in shared store search; meetings by default

### `zm search all`

search meetings and, with --only, messages, mail and notes in the local store

```sh
zm search all <query> [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | required | words to find; a word also matches longer words it starts. |

| Option | What it does |
|---|---|
| `--only <resources>` | comma-separated meetings,messages,mail,notes (default meetings). |
| `--limit <n>` | how many results, 1 through 1000 (default 100). Default: `100`. |
| `--page <n>` | which page, starting at 1. |
| `--max-meetings <n>` | most meetings to look through, newest first, or all (default 100). |
| `--exact` | request exact matching; unsupported meeting queries are reported as skipped. |

**Returns:** hit — kind, ref, provider, account, title, timestamp, excerpt, url, and 7 more; every field: zm commands info search all

**Example:** `zm personal search all "example plan" --json`

### `zm search meetings`

find words in stored meetings, or by meaning with --model

**Changes local data.**

```sh
zm search meetings <query> [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | required | words, OR, (groups), -word, "a phrase", "a b"\~N (within N lines), exact:word, from:"Name" (who said the line); date>=30d, project:, tag:, topic: choose meetings; a word also matches its other forms and spellings speech recognition garbled. |

| Option | What it does |
|---|---|
| `--meeting-id <id>` | only this stored meeting. |
| `--identity-id <id>` | meetings with this participant identity; does not say who spoke a hit. |
| `--person-id <id>` | meetings with a participant linked to this person. |
| `--event-id <id>` | only meetings linked to this stored event. |
| `--series-id <id>` | only meetings in this stored series. |
| `--project <project>` | meetings confirmed in this project, by name, key or alias. |
| `--tag <name>` | meetings with this tag, by name or alias. |
| `--topic-name <name>` | meetings with this topic, by name or alias. |
| `--since-time <time>` | meetings starting at or after this ISO 8601 date or time. |
| `--until-time <time>` | meetings starting at or before this ISO 8601 date or time; a date alone covers that whole local day. |
| `--limit <n>` | how many hits, 1 through 1000 (default 100). |
| `--cursor <cursor>` | continue from the previous page's page.next_cursor, with the same query and filters. |
| `--max-read-bytes <bytes>` | most stored bytes to read, 1 through 67108864 (default 4194304). |
| `--model <model>` | rank words and meaning together with this embedding model, building missing vectors first. |
| `--base-url <url>` | remote embedding service for --model; OpenAI reads OPENAI_API_KEY. |
| `--dims <n>` | vector size the remote service returns, in dimensions. |
| `--max-chunks <n>` | by meaning: most stored passages to compare (default 10000). |
| `--max-rows <n>` | by meaning: most transcript lines to read, 1 through 100000. |
| `--max-text-bytes <bytes>` | by meaning: most transcript text to read (default 4 MiB). |

**Returns:** meeting hit — ref, meeting, scope, id, excerpt, offset_ms, match, corrections, and 2 more; every field: zm commands info search meetings

**Next usually:** `zm meetings show <meeting>`, `zm meetings transcript <meeting>`, `zm meetings summary <meeting>`

**Example:** `zm personal search meetings "example plan" --since-time 2026-09-01 --json`, `zm personal search meetings "example plan" --model e5-small --json`

### `zm search recordings`

find words in the transcripts of a downloaded archive folder, before any import

```sh
zm search recordings <directory> <query> [options]
```

| Argument | | What it is |
|---|---|---|
| `directory` | required | archive folder. |
| `query` | required | words to find as one phrase, ignoring case. |

| Option | What it does |
|---|---|
| `--limit <n>` | how many hits, 1 through 1000 (default 100). |

**Returns:** hit — kind, ref, provider, account, title, timestamp, excerpt, url, and 7 more; every field: zm commands info search recordings

**Example:** `zm personal search recordings ./zoom-archive "example plan" --limit 100 --offline --json`

## `zm stats`

numbers about the stored meetings

### `zm stats meetings`

talk time, lines and words, by speaker and by week

#### `zm stats meetings show`

meetings, lines, words and talk time by week, with the top speakers

```sh
zm stats meetings show [options]
```

| Option | What it does |
|---|---|
| `--since-time <time>` | meetings starting at or after this date or time (ISO 8601, or 30d ago). |
| `--until-time <time>` | meetings starting at or before this date or time; a date alone is that whole day. |
| `--timezone <zone>` | the IANA zone dates and weeks are read in (default: this computer's). |
| `--event-id <id>` | only meetings linked to this stored event. |
| `--project <project>` | meetings confirmed in this project, by name, key or alias. |
| `--topic-name <name>` | meetings with this topic label, by name or alias. |
| `--max-rows <n>` | most transcript lines to read (default and at most 500000). |

**Returns:** meeting stats — time_zone, meetings, lines, words, talk_ms, weeks, top_speakers; every field: zm commands info stats meetings show

**Example:** `zm personal stats meetings show --since-time 30d --json`

#### `zm stats meetings top`

speakers by talk time: lines, words, meetings and their share of the talk

```sh
zm stats meetings top [options]
```

| Option | What it does |
|---|---|
| `--since-time <time>` | meetings starting at or after this date or time (ISO 8601, or 30d ago). |
| `--until-time <time>` | meetings starting at or before this date or time; a date alone is that whole day. |
| `--timezone <zone>` | the IANA zone dates and weeks are read in (default: this computer's). |
| `--event-id <id>` | only meetings linked to this stored event. |
| `--project <project>` | meetings confirmed in this project, by name, key or alias. |
| `--topic-name <name>` | meetings with this topic label, by name or alias. |
| `--max-rows <n>` | most transcript lines to read (default and at most 500000). |
| `--limit <n>` | how many speakers (default 20). |

**Returns:** meeting speaker — key, name, person_id, identity_id, meetings, lines, words, talk_ms, and 1 more; every field: zm commands info stats meetings top

**Example:** `zm personal stats meetings top --project RES --limit 5 --json`

## `zm review`

meetings since a point: summary, next steps and who talked how long

```sh
zm review [options]
```

| Option | What it does |
|---|---|
| `--since-time <time>` | meetings starting at or after this date or time (ISO 8601, or 30d ago). |
| `--until-time <time>` | meetings starting at or before this date or time; a date alone is that whole day. |
| `--timezone <zone>` | the IANA zone dates and weeks are read in (default: this computer's). |
| `--event-id <id>` | only meetings linked to this stored event. |
| `--project <project>` | meetings confirmed in this project, by name, key or alias. |
| `--topic-name <name>` | meetings with this topic label, by name or alias. |
| `--limit <n>` | most meetings, newest first (default 50, at most 200). |

**Returns:** meeting review — ref, id, title, started_at, duration_ms, participants_count, projects, transcript, and 2 more; every field: zm commands info review

**Example:** `zm personal review --json`, `zm personal review --since-time 30d --project RES --json`

## `zm mentions`

what the stored meetings point to: links shared in their chat

### `zm mentions list`

links shared in meeting chat, most shared first, by whom and where

```sh
zm mentions list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

| Option | What it does |
|---|---|
| `--timezone <zone>` | the IANA zone dates and weeks are read in (default: this computer's). |
| `--limit <n>` | how many links (default 100). |
| `--max-messages <n>` | most chat messages to read (default and at most 100000). |

**Returns:** meeting link — url, domain, document_id, count, first_at, last_at, senders, meetings; every field: zm commands info mentions list

**Example:** `zm personal mentions list started_at>=30d --json`, `zm personal mentions list project:RES --json`

## `zm searches`

saved meeting searches: a query and its options under a name

### `zm searches create`

save a search meetings query and its options without running it

**Changes local data.**

```sh
zm searches create <name> <query> [options]
```

| Argument | | What it is |
|---|---|---|
| `name` | required | up to 64 letters a–z, digits and hyphens, not only digits. |
| `query` | required | the query, as search meetings takes it. |

| Option | What it does |
|---|---|
| `--replace` | overwrite a saved search of the same name. |
| `--event-id <id>` | only meetings linked to this stored event. |
| `--project <project>` | meetings confirmed in this project, by name, key or alias. |
| `--topic-name <name>` | meetings with this topic, by name or alias. |
| `--since-time <time>` | meetings starting at or after this ISO 8601 date or time. |
| `--until-time <time>` | meetings starting at or before this ISO 8601 date or time; a date alone covers that whole local day. |
| `--limit <n>` | how many hits, 1 through 1000 (default 100). |
| `--max-read-bytes <bytes>` | most stored bytes to read, 1 through 67108864 (default 4194304). |
| `--model <model>` | rank words and meaning together with this embedding model, building missing vectors first. |
| `--base-url <url>` | remote embedding service for --model; OpenAI reads OPENAI_API_KEY. |
| `--dims <n>` | vector size the remote service returns, in dimensions. |
| `--max-chunks <n>` | by meaning: most stored passages to compare (default 10000). |
| `--max-rows <n>` | by meaning: most transcript lines to read, 1 through 100000. |
| `--max-text-bytes <bytes>` | by meaning: most transcript text to read (default 4 MiB). |

**Returns:** saved search — id, name, command, params, language, version, fields_version, created_at, and 2 more; every field: zm commands info searches create

**Example:** `zm personal searches create weekly-plan "example plan date>=7d" --project RES --json`

### `zm searches run`

run a saved search; answers as search meetings does

**Changes local data.**

```sh
zm searches run <name>
```

| Argument | | What it is |
|---|---|---|
| `name` | required | a saved search's name. |

**Returns:** meeting hit — ref, meeting, scope, id, excerpt, offset_ms, match, corrections, and 2 more; every field: zm commands info searches run

**Next usually:** `zm meetings show <meeting>`, `zm meetings transcript <meeting>`, `zm meetings summary <meeting>`

**Example:** `zm personal searches run weekly-plan --json`

### `zm searches list`

the saved meeting searches, by name

```sh
zm searches list [query]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms; this list filters by none yet. |

**Returns:** saved search — id, name, command, params, language, version, fields_version, created_at, and 2 more; every field: zm commands info searches list

**Example:** `zm personal searches list --json`

### `zm searches show`

one saved search: its query, options and how often it ran

```sh
zm searches show <name>
```

| Argument | | What it is |
|---|---|---|
| `name` | required | a saved search's name. |

**Returns:** saved search — id, name, command, params, language, version, fields_version, created_at, and 2 more; every field: zm commands info searches show

**Example:** `zm personal searches show weekly-plan`

### `zm searches delete`

delete a saved search

**Changes local data.**

```sh
zm searches delete <name>
```

| Argument | | What it is |
|---|---|---|
| `name` | required | a saved search's name. |

**Returns:** saved search — id, name, command, params, language, version, fields_version, created_at, and 2 more; every field: zm commands info searches delete

**Example:** `zm personal searches delete weekly-plan --dry-run`

## `zm batch`

run bounded stored meeting reads: search meetings and meetings passage

**Changes local data.**

```sh
zm batch <file> [options]
```

| Argument | | What it is |
|---|---|---|
| `file` | required | JSON request file, or - for stdin. |

| Option | What it does |
|---|---|
| `--max-read-bytes <bytes>` | aggregate stored-text read ceilings, including one 4 MiB index pass; at most 67108864. |
| `--format <format>` | text, markdown or json. One of: `text`, `markdown`, `json`. Default: `text`. |

**Returns:** meeting batch result — id, command, status, answer, complete, error; every field: zm commands info batch

**Example:** `zm personal batch requests.json --json`

## `zm guide`

scenarios: the commands for a common task, in order, and why each

```sh
zm guide [name]
```

| Argument | | What it is |
|---|---|---|
| `name` | optional | one scenario; without it, the list. |

**Returns:** scenarios: the commands for a common task, in order, and why each

**Example:** `zm guide`, `zm guide archive-recordings --json`

## Exit codes

Use the shared exit code rather than matching diagnostic text.

| Code | When |
|---|---|
| `0` | it worked |
| `2` | `validation_error` |
| `3` | `configuration_error` |
| `4` | `authentication_error` |
| `5` | `permission_error` |
| `6` | `not_found` |
| `7` | `confirmation_required` |
| `8` | `rate_limited` |
| `9` | `timeout` |
| `10` | `network_error` |
| `11` | `provider_error` |
| `12` | `provider_unavailable` |
| `13` | `invalid_response` |
| `14` | `outcome_unknown` |
| `130` | `cancelled` |
| `1` | anything else |

Remote meeting changes preview by default. Exit code 14 reports an uncertain dispatched outcome; inspect the remote state before retrying. Foreground watches require JSONL when output is piped.
