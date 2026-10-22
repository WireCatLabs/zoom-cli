<!-- Generated from the command tree by scripts/commands.ts. Do not edit; run pnpm generate. -->

# Commands

Look up the exact command, arguments and options for reading meetings, archiving recordings or managing the Zoom schedule. Stored meeting IDs differ from remote Zoom IDs; archive destinations are explicit local directories. Start with installation or a task guide when connecting for the first time.

## Global options

These options apply to every command.

| Option | What it does |
|---|---|
| `-V, --version` | output the version number. |
| `--json` | one JSON value; --json=id,title keeps only those fields. |
| `--jsonl` | one JSON object per item. |
| `--no-input` | disable interactive login. |
| `--quiet` | suppress non-error diagnostics. |
| `--timeout <duration>` | command deadline: reads 30s, login 5m, downloads/transcription 1h; watch/MCP have no default. |
| `--max-output-bytes <bytes>` | bound rendered result bytes (default 4194304; zero is unlimited). |
| `--offline` | refuse network requests. |
| `--debug` | on a failure, its whole record — cause and stack — in place of the short line. |

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

**Returns:** meeting — ref, id, provider, account, title, url, started_at, ended_at, and 8 more

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

**Returns:** meeting details — ref, id, provider, account, title, url, started_at, ended_at, and 16 more

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

**Returns:** meeting transcript — ref, meeting, source, language, superseded_at, created_at, lines

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

**Returns:** meeting summary — id, meeting, source, title, overview, sections, next_steps, content, and 3 more

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

**Returns:** export a meeting as Markdown or one transcript as WebVTT

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

**Returns:** find meeting participants by name or email

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

**Returns:** bring the stored meetings up to date from the connected account

**Example:** `zm personal meetings sync --json`

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

**Returns:** import downloaded meeting transcripts

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

**Returns:** meeting series inventory — schema_version, kind, scope, after, until, items, page, fingerprint, and 2 more

**Example:** `zm meetings scheduled --json`

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

**Returns:** meeting project evidence — schema_version, kind, account_id, query, project, term, hits, association, and 5 more

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

**Returns:** meeting project candidates — schema_version, kind, source, input_fingerprint, vocabulary_fingerprint, association, items, limits, and 2 more

**Example:** `zm meetings projects scan meeting:1/2 --json`

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

**Returns:** meeting preparation — schema_version, kind, account_id, upcoming, series, history_window, meetings, related, and 6 more

**Example:** `zm meetings prepare 123 --json`

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

**Returns:** preview linking a stored meeting to an event; --yes applies it

**Example:** `zm meetings update meeting:1/1 --event-id 1 --yes --json`

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

**Returns:** preview linking a meeting participant to a stored person; --yes applies it

**Example:** `zm meetings link meeting:1/1 --participant-id 1 --person 1 --yes --json`

### `zm meetings transcribe`

preview transcribing a recording on this machine; --yes adds the transcript

**Changes local data.**

```sh
zm meetings transcribe <meeting> <file> [options]
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | stored meeting id or meeting reference. |
| `file` | required | local PCM16 WAV file (16 or 48 kHz, mono/stereo). |

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

**Returns:** preview transcribing a recording on this machine; --yes adds the transcript

**Example:** `zm meetings transcribe meeting:3/12 ./AliceExample.wav --model parakeet-v3 --json`

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

**Returns:** read the stored transcript lines, chat or summary behind a meeting reference

**Example:** `zm meetings evidence meeting:3/15 --json`

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

**Returns:** what the stored meetings say about a person, through linked identities

**Example:** `zm meetings context person:7 --meetings 10 --json`

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

**Returns:** preview the task a meeting line would become, without creating it

**Example:** `zm meetings task-proposal meeting:3/15/20/0 --type promise --json`

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

**Returns:** read a cited cue with bounded context before and after it

**Example:** `zm meetings passage meeting:1/1/1/0 --json`

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

**Returns:** preview building meeting vectors; --yes builds one batch

**Example:** `zm meetings embeddings --model e5-small --json`

## `zm events`

the owner's stored events

### `zm events list`

list stored events

```sh
zm events list [options]
```

| Option | What it does |
|---|---|
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |

**Returns:** list stored events

**Example:** `zm personal events list --json`

## `zm commands`

discover commands, flags and examples, optionally scoped to a command path

```sh
zm commands [path]
```

| Argument | | What it is |
|---|---|---|
| `path` | optional | resource or command path. |

**Returns:** discover commands, flags and examples, optionally scoped to a command path

**Example:** `zm commands --json`

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

**Example:** `zm session status --json`, `zm session status --check --json`

### `zm session start`

log in to Zoom through your browser

**Changes remote Zoom data.**

```sh
zm session start [options]
```

| Option | What it does |
|---|---|
| `--browser <program>` | browser program. |

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

**Example:** `zm upgrade --check`, `zm upgrade`

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

**Returns:** keep fetching new meetings from Zoom, or rescanning a folder, until stopped

**Example:** `zm watch files ./downloads --pause 10s --jsonl`, `zm watch api --lookback-days 2 --jsonl`

## `zm recordings`

cloud recording assets and verified local archives

### `zm recordings list`

list cloud recording occurrences (last 30 days by default)

```sh
zm recordings list [options]
```

| Option | What it does |
|---|---|
| `--since-time <time>` | first day, YYYY-MM-DD. |
| `--until-time <time>` | last day, YYYY-MM-DD (default today in --timezone). |
| `--timezone <zone>` | IANA timezone of today (default the computer's). |

**Returns:** list cloud recording occurrences (last 30 days by default)

**Example:** `zm recordings list --since-time 2026-10-01 --until-time 2026-10-10 --json`

### `zm recordings sync`

download a date range of recordings into an archive folder, a month at a time

**Changes local data.**

```sh
zm recordings sync [options]
```

| Option | What it does |
|---|---|
| `--since-time <time>` | first day, YYYY-MM-DD. |
| `--until-time <time>` | last day, YYYY-MM-DD; at most ten years after the first. |
| `--output-dir <dir>` | explicit archive directory. |
| `--max-bytes <bytes>` | maximum bytes per recording file. |
| `--resume` | resume verified partial downloads and archive progress; requires a local profile. |
| `--no-resume` | disable persistent resume state for this invocation. |
| `--checkpoint <file>` | explicit durable checkpoint file; implies resume. |
| `--recheck-since-time <time>` | look again from this day, YYYY-MM-DD, for recordings that came late. |
| `--max-pages <pages>` | catalog page limit from 1 through 10000 (default 1000). |
| `--max-entries <n>` | occurrence limit from 1 through 10000 (default 10000). |

**Returns:** download a date range of recordings into an archive folder, a month at a time

**Example:** `zm recordings sync --since-time 2026-01-01 --until-time 2026-10-10 --output-dir ./archive --jsonl`

### `zm recordings show`

show downloadable asset metadata without signed URLs

```sh
zm recordings show <meeting>
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | meeting id or occurrence UUID. |

**Returns:** show downloadable asset metadata without signed URLs

**Example:** `zm recordings show example-occurrence --json`

### `zm recordings download`

stream recording assets into a verified local archive

**Changes local data.**

```sh
zm recordings download <meeting> [options]
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | meeting id or occurrence UUID. |

| Option | What it does |
|---|---|
| `--output-dir <dir>` | explicit archive directory. |
| `--file-ids <ids>` | comma-separated recording file ids. |
| `--max-bytes <bytes>` | per-file download byte limit (default 20 GiB). |
| `--resume` | resume verified partial downloads and archive progress; requires a local profile. |
| `--no-resume` | disable persistent resume state for this invocation. |

**Returns:** stream recording assets into a verified local archive

**Example:** `zm recordings download example-occurrence --output-dir ./zoom-archive --json`

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

**Returns:** read the transcripts of a local archive, checking each file first

**Example:** `zm recordings archive transcript ./zoom-archive --uuid example-occurrence --json`

#### `zm recordings archive show`

show what a local archive holds, from its transfer records

```sh
zm recordings archive show <directory>
```

| Argument | | What it is |
|---|---|---|
| `directory` | required | archive folder. |

**Returns:** show what a local archive holds, from its transfer records

**Example:** `zm recordings archive show ./zoom-archive --json`

#### `zm recordings archive check`

check the size and checksum of every file in a local archive

```sh
zm recordings archive check <directory>
```

| Argument | | What it is |
|---|---|---|
| `directory` | required | archive folder. |

**Returns:** check the size and checksum of every file in a local archive

**Example:** `zm recordings archive check ./zoom-archive --json`

#### `zm recordings archive locks`

list the locks on a local archive: active, stale or another machine's

```sh
zm recordings archive locks <directory>
```

| Argument | | What it is |
|---|---|---|
| `directory` | required | archive folder. |

**Returns:** list the locks on a local archive: active, stale or another machine's

**Example:** `zm recordings archive locks ./zoom-archive --json`

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

**Returns:** preview removing stale locks; --yes removes them

**Example:** `zm recordings archive recover ./zoom-archive --dry-run --json`

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

**Returns:** check an archive's transcripts, then add them to the stored meetings

**Example:** `zm recordings archive import ./archive --jsonl`

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

**Returns:** preview a daily archive job; --yes installs its timer

**Example:** `zm recordings schedule create --name daily --output-dir /home/AliceExample/archive --since-time 2026-01-01 --at 03:15 --timezone UTC --json`

#### `zm recordings schedule list`

list saved local jobs; live timer state is not checked

```sh
zm recordings schedule list
```

**Returns:** list saved local jobs; live timer state is not checked

**Example:** `zm recordings schedule list --offline --json`

#### `zm recordings schedule show`

show one saved local job and its captured settings

```sh
zm recordings schedule show <job>
```

| Argument | | What it is |
|---|---|---|
| `job` | required | saved job id. |

**Returns:** show one saved local job and its captured settings

**Example:** `zm recordings schedule show example-job --offline --json`

#### `zm recordings schedule run`

run the captured job once with durable archive progress

**Changes local data.**

```sh
zm recordings schedule run <job>
```

| Argument | | What it is |
|---|---|---|
| `job` | required | saved job id. |

**Returns:** run the captured job once with durable archive progress

**Example:** `zm recordings schedule run example-job --jsonl`

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

**Returns:** preview disabling a saved timer; --yes disables it without deleting files

**Example:** `zm recordings schedule disable example-job --yes --json`

## `zm remote-meetings`

upcoming Zoom meetings; stored meeting reads remain under meetings

### `zm remote-meetings list`

list upcoming meetings

```sh
zm remote-meetings list
```

**Returns:** list upcoming meetings

**Example:** `zm remote-meetings list --json`

### `zm remote-meetings show`

show an upcoming meeting

```sh
zm remote-meetings show <meeting>
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | positive numeric Zoom meeting id. |

**Returns:** show an upcoming meeting

**Example:** `zm remote-meetings show 123456789 --json`

### `zm remote-meetings invitation`

read invitation text

```sh
zm remote-meetings invitation <meeting>
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | positive numeric Zoom meeting id. |

**Returns:** read invitation text

**Example:** `zm remote-meetings invitation 123456789 --json`

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

**Returns:** create a Zoom meeting; asks first, --dry-run previews

**Example:** `zm remote-meetings create --title "Example planning" --start-time 2026-10-10T15:30:00Z --dry-run --json`

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

**Returns:** change a Zoom meeting; asks first, --dry-run previews

**Example:** `zm remote-meetings update 123456789 --title "Example planning" --dry-run --json`

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

**Returns:** cancel a Zoom meeting; asks first, --dry-run previews

**Example:** `zm remote-meetings cancel 123456789 --dry-run --json`

## `zm skill`

the instructions an agent is given for this tool

### `zm skill show`

print SKILL.md — `zm skill install` puts it where Claude Code, Codex and Gemini CLI look for it

```sh
zm skill show
```

**Returns:** print SKILL.md — `zm skill install` puts it where Claude Code, Codex and Gemini CLI look…

**Example:** `zm skill show --json`

### `zm skill install`

write SKILL.md to \~/.claude/skills/zoom-cli/ (Claude Code) and \~/.agents/skills/zoom-cli/ (Codex, Gemini CLI)

**Changes local data.**

```sh
zm skill install [options]
```

| Option | What it does |
|---|---|
| `--for <agents>` | which agents to install for. One of: `claude`, `agents`, `all`. Default: `all`. |

**Returns:** write SKILL.md to ~/.claude/skills/zoom-cli/ (Claude Code) and ~/.agents/skills/zoom-cli/…

**Example:** `zm skill install --for agents --json`

## `zm mcp`

serve zm's commands to an MCP agent over stdio, as the named profile allows them

**Changes local data.**

```sh
zm mcp
```

**Returns:** serve zm's commands to an MCP agent over stdio, as the named profile allows them

**Example:** `zm personal mcp`

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
| `--max-meetings <n>` | most meetings to look at, 1 through 1000 (default 100). Default: `100`. |
| `--meeting-cursor <json>` | source-only continuation from meetings.next_cursor. |
| `--exact` | request exact matching; unsupported meeting queries are reported as skipped. |

**Returns:** search meetings and, with --only, messages, mail and notes in the local store

**Example:** `zm search all "example plan" --json`

### `zm search meetings`

find words in stored meetings, or by meaning with --model

**Changes local data.**

```sh
zm search meetings <query> [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | required | words, OR, (groups), -word, "a phrase", "a b"\~N (within N lines), exact:word, from:"Name" (who said the line); a word also matches its other forms and spellings speech recognition garbled. |

| Option | What it does |
|---|---|
| `--meeting-id <id>` | only this stored meeting. |
| `--identity-id <id>` | meetings with this participant identity; does not say who spoke a hit. |
| `--person-id <id>` | meetings with a participant linked to this person. |
| `--event-id <id>` | only meetings linked to this stored event. |
| `--series-id <id>` | only meetings in this stored series. |
| `--project <name>` | meetings confirmed in this project, by name, key or alias. |
| `--tag <name>` | meetings with this tag, by name or alias. |
| `--topic <name>` | meetings with this topic, by name or alias. |
| `--since-time <time>` | meetings starting at or after this ISO 8601 date or time. |
| `--until-time <time>` | meetings starting at or before this ISO 8601 date or time; a date alone covers that whole local day. |
| `--limit <n>` | how many hits, 1 through 1000 (default 100). |
| `--cursor <cursor>` | continue from the previous page's page.next_cursor, with the same query and filters. |
| `--max-read-bytes <bytes>` | most stored bytes to read, 1 through 67108864 (default 4194304). |
| `--model <model>` | search by meaning with this embedding model, building missing vectors first. |
| `--base-url <url>` | remote embedding service for --model; OpenAI reads OPENAI_API_KEY. |
| `--dims <n>` | vector size the remote service returns, in dimensions. |
| `--max-chunks <n>` | by meaning: most stored passages to compare. |
| `--max-rows <n>` | by meaning: most transcript lines to read, 1 through 100000. |
| `--max-text-bytes <bytes>` | by meaning: most transcript text to read (default 4 MiB). |

**Returns:** meeting hit — ref, meeting, scope, id, excerpt, offset_ms, match, corrections, and 1 more

**Next usually:** `zm meetings show <meeting>`, `zm meetings transcript <meeting>`, `zm meetings summary <meeting>`

**Example:** `zm search meetings "example plan" --since-time 2026-09-01 --json`, `zm search meetings "example plan" --model e5-small --json`

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

**Returns:** hit — kind, ref, provider, account, title, timestamp, excerpt, url, and 4 more

**Example:** `zm search recordings ./zoom-archive "example plan" --limit 100 --offline --json`

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

**Returns:** run bounded stored meeting reads: search meetings and meetings passage

**Example:** `zm batch requests.json --json`

## `zm guide`

scenarios: the commands for a common task, in order, and why each

```sh
zm guide [name]
```

| Argument | | What it is |
|---|---|---|
| `name` | optional | one scenario; without it, the list. |

**Returns:** scenarios: the commands for a common task, in order, and why each

**Example:** `zm guide`, `zm guide <name> --json`

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
