<!-- Generated from the command tree by scripts/commands.ts. Do not edit; run pnpm generate. -->

# Commands

Command descriptions and options come from the installed program's command tree. Stored meeting ids differ from remote Zoom ids. Archive paths are explicit local directories.

## Global options

These options apply to every command.

| Option | What it does |
|---|---|
| `-V, --version` | output the version number. |
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |
| `--no-input` | disable interactive login. |
| `--interactive` | permit browser approval in an interactive terminal. |
| `--quiet` | suppress non-error diagnostics. |
| `--fields <paths>` | project result fields, such as id,title. |
| `--timeout <duration>` | command deadline: reads 30s, login 5m, downloads/transcription 1h; watch/MCP have no default. |
| `--max-output-bytes <bytes>` | bound rendered result bytes (default 4194304; zero is unlimited). |
| `--offline` | refuse network requests. |

## `zm config`

local Zoom configuration

### `zm config show`

show local configuration

```sh
zm config show
```

### `zm config set`

set a configuration value

**Changes local data.**

```sh
zm config set <key> <value>
```

| Argument | | What it is |
|---|---|---|
| `key` | required |  |
| `value` | required |  |

## `zm login`

log in to Zoom through your browser

**Changes local data.**

```sh
zm login [options]
```

| Option | What it does |
|---|---|
| `--browser <program>` | browser program. |

## `zm meetings`

stored meetings and their records

### `zm meetings list`

list stored meetings

```sh
zm meetings list [options]
```

| Option | What it does |
|---|---|
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |
| `--since <date>` | meetings starting at or after this date. |
| `--until <date>` | meetings starting at or before this date. |
| `--limit <n>` | meetings per page. Default: `100`. |
| `--page <n>` | page number. Default: `1`. |

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

### `zm meetings search`

search stored transcripts, chat and summaries

```sh
zm meetings search <query> [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | required |  |

| Option | What it does |
|---|---|
| `--since <date>` | meetings starting at or after this date. |
| `--until <date>` | meetings starting at or before this date. |
| `--event-id <id>` | only meetings linked to this stored event. |
| `--series-id <id>` | only meetings in this stored series. |
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |

### `zm meetings people`

find meeting participants by name or email

```sh
zm meetings people <query> [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | required |  |

| Option | What it does |
|---|---|
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |

### `zm meetings link-event`

preview or apply an owner-selected event link

**Changes local data.**

```sh
zm meetings link-event <reference> [options]
```

| Argument | | What it is |
|---|---|---|
| `reference` | required |  |

| Option | What it does |
|---|---|
| `--event-id <id>` | stored event id, or none to unlink. |
| `--expected-event-id <id>` | compare current event id, or none. |
| `--yes` | apply this local change once. |
| `--dry-run` | preview even when --yes is present. |

### `zm meetings link-person`

preview or apply an explicit participant identity link to a stored person

**Changes local data.**

```sh
zm meetings link-person <reference> [options]
```

| Argument | | What it is |
|---|---|---|
| `reference` | required |  |

| Option | What it does |
|---|---|
| `--participant-id <id>` | participant id from this meeting. |
| `--person <uid>` | explicit stored person UID. |
| `--target-accounts <ids>` | explicit additional account ids authorized for target-person lookup. |
| `--expected-person <uid>` | compare current person UID, or none. |
| `--yes` | apply this local change once. |
| `--dry-run` | preview even when --yes is present. |

### `zm meetings transcribe`

preview local PCM WAV transcription; --yes recognizes and appends an independent transcript

**Changes local data.**

```sh
zm meetings transcribe <meeting> <file> [options]
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | selected-account stored meeting id or meeting reference. |
| `file` | required | local PCM16 WAV file (16 or 48 kHz, mono/stereo). |

| Option | What it does |
|---|---|
| `--model <model>` | explicit installed speech model. |
| `--models-dir <directory>` | shared installed speech-model directory. |
| `--max-bytes <bytes>` | bounded media input bytes (default 1 GiB). |
| `--max-duration <duration>` | bounded audio duration (default 4h). |
| `--max-segments <count>` | recognized segment limit (default 10000). |
| `--max-text-bytes <bytes>` | aggregate transcript text limit (default 4 MiB). |
| `--yes` | recognize locally and append to the existing meeting. |
| `--dry-run` | preview even when --yes is present. |

### `zm meetings search-page`

bounded keyword search with configured stemming and hit continuation

```sh
zm meetings search-page <query> [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | required |  |

| Option | What it does |
|---|---|
| `--meeting-id <id>` | restrict to a meeting in the selected account. |
| `--since <date>` | meeting start at or after an ISO date or timestamp. |
| `--until <date>` | meeting start at or before an ISO date or timestamp. |
| `--limit <count>` | hit limit from 1 through 1000 (default 100). |
| `--after <cursor>` | opaque nextCursor from the same query and selected account. |
| `--max-read-bytes <bytes>` | raw SQL read budget from 1 through 67108864 (default 4194304). |

### `zm meetings search-index`

preview or apply one bounded batch of queued meeting search indexing

**Changes local data.**

```sh
zm meetings search-index [options]
```

| Option | What it does |
|---|---|
| `--limit <count>` | queued record limit from 1 through 1000 (default 100). |
| `--max-read-bytes <bytes>` | raw SQL read budget from 1 through 67108864 (default 4194304). |
| `--yes` | apply this indexing batch once. |
| `--dry-run` | preview even when --yes is present. |

### `zm meetings evidence`

read bounded stored evidence from a selected-account meeting reference

```sh
zm meetings evidence <reference> [options]
```

| Argument | | What it is |
|---|---|---|
| `reference` | required |  |

| Option | What it does |
|---|---|
| `--cues <count>` | cue limit from 1 through 1000. |
| `--bytes <count>` | content byte limit from 2 through 4194304. |
| `--after <reference>` | resume after a cue reference from the same source. |
| `--after-transcript-id <id>` | resume root-reference revision scan, including empty revisions. |
| `--max-read-bytes <count>` | SQL input byte budget per page (default 4 MiB). |
| `--max-transcript-pages <count>` | transcript page work budget from 1 through 1000. |

### `zm meetings context`

identity-linked person context restricted to the selected account; completeness is explicit

```sh
zm meetings context <person> [options]
```

| Argument | | What it is |
|---|---|---|
| `person` | required |  |

| Option | What it does |
|---|---|
| `--cues <count>` | cue limit from 1 through 1000. |
| `--bytes <count>` | content byte limit from 2 through 4194304. |
| `--meetings <count>` | meeting limit from 1 through 100. |
| `--scan-limit <count>` | identity-link candidate bound from 1 through 1000. |
| `--since <iso>` | read identity links since this ISO instant. |

### `zm meetings task-proposal`

preview a provenance-linked task proposal without creating a task

```sh
zm meetings task-proposal <reference> [options]
```

| Argument | | What it is |
|---|---|---|
| `reference` | required |  |

| Option | What it does |
|---|---|
| `--kind <kind>` | question, request, mention or promise. |

### `zm meetings semantic`

search stored meeting vectors with an explicit query model; ranks only scanned candidates

```sh
zm meetings semantic <query> [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | required |  |

| Option | What it does |
|---|---|
| `--model <id>` | explicit installed local model ID, or model served at --base-url. |
| `--base-url <url>` | explicit remote endpoint; OpenAI uses OPENAI_API_KEY. |
| `--dims <count>` | remote embedding vector dimensions. |
| `--limit <count>` | bounded batch/result count from 1 through 1000. |
| `--max-rows <count>` | transcript cue read limit from 1 through 100000. |
| `--max-text-bytes <count>` | aggregate transcript text read byte limit (default 4 MiB). |
| `--max-chunks <count>` | embedded candidate scan bound. |
| `--after-chunk-id <id>` | candidate scan continuation; not globally ranked result pagination. |

### `zm meetings embeddings`

preview meeting vector generation; --yes explicitly rebuilds and embeds one bounded batch

**Changes local data.**

```sh
zm meetings embeddings [options]
```

| Option | What it does |
|---|---|
| `--model <id>` | explicit installed local model ID, or model served at --base-url. |
| `--base-url <url>` | explicit remote endpoint; OpenAI uses OPENAI_API_KEY. |
| `--dims <count>` | remote embedding vector dimensions. |
| `--limit <count>` | bounded batch/result count from 1 through 1000. |
| `--max-rows <count>` | transcript cue read limit from 1 through 100000. |
| `--max-text-bytes <count>` | aggregate transcript text read byte limit (default 4 MiB). |
| `--after-transcript-id <id>` | transcript chunk rebuild continuation. |
| `--after-hash <hash>` | missing embedding batch continuation. |
| `--yes` | apply chunk rebuild and embedding generation; preview otherwise. |

## `zm pull`

fetch meeting records from the connected account

**Changes local data.**

```sh
zm pull [options]
```

| Option | What it does |
|---|---|
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |
| `--since <date>` | fetch occurrences starting at or after this date. |
| `--lookback-days <days>` | revisit recent occurrences for late transcripts (0–31). Default: `0`. |

## `zm import`

import downloaded meeting transcripts

**Changes local data.**

```sh
zm import <folder> [options]
```

| Argument | | What it is |
|---|---|---|
| `folder` | required |  |

| Option | What it does |
|---|---|
| `--json` | one JSON value. |
| `--jsonl` | one JSON object per item. |

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

## `zm commands`

discover commands, flags and examples, optionally scoped to a command path

```sh
zm commands [path]
```

| Argument | | What it is |
|---|---|---|
| `path` | optional | resource or command path. |

## `zm complete`

answer shell completion requests

```sh
zm complete [words]
```

| Argument | | What it is |
|---|---|---|
| `words` | optional | shell words ending in the partial word. |

## `zm doctor`

check local runtime and public config without a login or database

```sh
zm doctor
```

## `zm session`

inspect the saved OAuth session separately from local data profiles

### `zm session status`

show cached login state; remote verification is explicit

```sh
zm session status [options]
```

| Option | What it does |
|---|---|
| `--check` | verify the session with Zoom. |

## `zm watch`

foreground serial API pulls or folder rescans, with closed-store receipts

**Changes local data.**

```sh
zm watch [folder] [options]
```

| Argument | | What it is |
|---|---|---|
| `folder` | optional | downloaded VTT/TXT folder; defaults source to files. |

| Option | What it does |
|---|---|
| `--source <source>` | api or files; otherwise uses configured source. One of: `api`, `files`. |
| `--since <timestamp>` | initial API lower bound until the first successful cursor write. |
| `--lookback-days <days>` | API cursor overlap for late transcripts (0 through 31). |
| `--interval <duration>` | delay after each completed receipt (1s through 24h). Default: `10000`. |

## `zm recordings`

cloud recording assets and verified local archives

### `zm recordings list`

list cloud recording occurrences (last 30 days by default)

```sh
zm recordings list [options]
```

| Option | What it does |
|---|---|
| `--from <date>` | first YYYY-MM-DD date. |
| `--to <date>` | last YYYY-MM-DD date. |

### `zm recordings sync`

serial monthly recording archive synchronization with completed JSONL receipts

**Changes local data.**

```sh
zm recordings sync [options]
```

| Option | What it does |
|---|---|
| `--from <date>` | first YYYY-MM-DD date. |
| `--to <date>` | last YYYY-MM-DD date (at most ten years). |
| `--destination <directory>` | explicit archive directory. |
| `--max-bytes <bytes>` | maximum bytes per recording file. |
| `--resume` | resume verified partial downloads and archive progress; requires a local profile. |
| `--no-resume` | disable persistent resume state for this invocation. |
| `--checkpoint <file>` | explicit durable checkpoint file; implies resume. |
| `--recheck-from <date>` | revisit completed windows from this YYYY-MM-DD date for late recordings. |
| `--max-pages <pages>` | catalog page limit from 1 through 10000 (default 1000). |
| `--max-entries <entries>` | occurrence limit from 1 through 10000 (default 10000). |

### `zm recordings show`

show downloadable asset metadata without signed URLs

```sh
zm recordings show <meeting>
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | meeting id or occurrence UUID. |

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
| `--destination <directory>` | explicit archive directory. |
| `--file-ids <ids>` | comma-separated recording file ids. |
| `--max-bytes <bytes>` | per-file download byte limit (default 20 GiB). |
| `--resume` | resume verified partial downloads and archive progress; requires a local profile. |
| `--no-resume` | disable persistent resume state for this invocation. |

### `zm recordings archive`

inspect archives without Zoom or a database

#### `zm recordings archive transcript`

read checksum-verified local VTT cues without Zoom or a database

```sh
zm recordings archive transcript <directory> [options]
```

| Argument | | What it is |
|---|---|---|
| `directory` | required |  |

| Option | What it does |
|---|---|
| `--uuid <uuid>` | select an occurrence UUID. |
| `--file-ids <ids>` | select comma-separated transcript asset ids. |
| `--max-bytes <bytes>` | maximum VTT bytes per file (default 8 MiB). |

#### `zm recordings archive search`

literal normalized text search across verified local VTT cues

```sh
zm recordings archive search <directory> <query> [options]
```

| Argument | | What it is |
|---|---|---|
| `directory` | required |  |
| `query` | required |  |

| Option | What it does |
|---|---|
| `--uuid <uuid>` | select an occurrence UUID. |
| `--file-ids <ids>` | select comma-separated transcript asset ids. |
| `--max-bytes <bytes>` | maximum VTT bytes per file (default 8 MiB). |
| `--limit <matches>` | maximum matches from 1 through 1000 (default 100). |

#### `zm recordings archive inspect`

read local transfer manifests

```sh
zm recordings archive inspect <directory>
```

| Argument | | What it is |
|---|---|---|
| `directory` | required |  |

#### `zm recordings archive verify`

verify local file sizes and checksums

```sh
zm recordings archive verify <directory>
```

| Argument | | What it is |
|---|---|---|
| `directory` | required |  |

#### `zm recordings archive locks`

inspect active, stale or foreign archive locks

```sh
zm recordings archive locks <directory>
```

| Argument | | What it is |
|---|---|---|
| `directory` | required |  |

#### `zm recordings archive recover`

preview recovery of recognized stale local locks

**Changes local data.**

```sh
zm recordings archive recover <directory> [options]
```

| Argument | | What it is |
|---|---|---|
| `directory` | required |  |

| Option | What it does |
|---|---|
| `--yes` | remove recognized locks left by a dead local process. |
| `--dry-run` | preview only, including when --yes is present. |

#### `zm recordings archive import`

verify all selected VTT before atomic per-occurrence transcript append

**Changes local data.**

```sh
zm recordings archive import <directory> [options]
```

| Argument | | What it is |
|---|---|---|
| `directory` | required |  |

| Option | What it does |
|---|---|
| `--uuid <uuid>` | select an occurrence UUID. |
| `--file-ids <ids>` | select comma-separated VTT asset ids. |
| `--max-bytes <bytes>` | per-file VTT byte limit (default 8 MiB). |
| `--max-total-bytes <bytes>` | aggregate VTT byte limit before any write (default 64 MiB). |

### `zm recordings schedule`

local archive jobs and Linux user systemd timers

#### `zm recordings schedule create`

preview a captured daily archive job; --yes installs its user timer

**Changes local data.**

```sh
zm recordings schedule create [options]
```

| Option | What it does |
|---|---|
| `--name <name>` | local job name. |
| `--destination <directory>` | absolute archive directory. |
| `--from <date>` | first YYYY-MM-DD archive date. |
| `--at <time>` | daily HH:mm time. |
| `--timezone <zone>` | IANA timezone for the timer. |
| `--lookback-days <days>` | revisit the latest zero through 31 UTC days (default seven). |
| `--max-bytes <bytes>` | maximum bytes per recording file (default 20 GiB). |
| `--yes` | install and enable the captured timer. |
| `--dry-run` | preview even when --yes is present. |

#### `zm recordings schedule list`

list saved local jobs; live timer state is not checked

```sh
zm recordings schedule list
```

#### `zm recordings schedule show`

show one saved local job and its captured settings

```sh
zm recordings schedule show <id>
```

| Argument | | What it is |
|---|---|---|
| `id` | required | schedule id. |

#### `zm recordings schedule run`

run the captured job once with durable archive progress

**Changes local data.**

```sh
zm recordings schedule run <id>
```

| Argument | | What it is |
|---|---|---|
| `id` | required | schedule id. |

#### `zm recordings schedule disable`

preview disabling a saved timer; --yes disables it without deleting files

**Changes local data.**

```sh
zm recordings schedule disable <id> [options]
```

| Argument | | What it is |
|---|---|---|
| `id` | required | schedule id. |

| Option | What it does |
|---|---|
| `--yes` | disable and stop the timer. |
| `--dry-run` | preview even when --yes is present. |

## `zm remote-meetings`

upcoming Zoom meetings; stored meeting reads remain under meetings

### `zm remote-meetings list`

list upcoming meetings

```sh
zm remote-meetings list
```

### `zm remote-meetings show`

show an upcoming meeting

```sh
zm remote-meetings show <meeting>
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | positive numeric Zoom meeting id. |

### `zm remote-meetings invitation`

read invitation text

```sh
zm remote-meetings invitation <meeting>
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | positive numeric Zoom meeting id. |

### `zm remote-meetings create`

preview a meeting creation; --yes performs it once

**Changes remote Zoom data.**

```sh
zm remote-meetings create [options]
```

| Option | What it does |
|---|---|
| `--topic <text>` | meeting topic. |
| `--start-time <timestamp>` | ISO start time with timezone. |
| `--duration-minutes <minutes>` | positive meeting duration in minutes. |
| `--timezone <zone>` | IANA timezone. |
| `--agenda <text>` | meeting agenda. |
| `--type <type>` | instant (1) or scheduled (2). |
| `--yes` | apply the remote mutation once instead of previewing. |
| `--dry-run` | preview only, including when --yes is present. |

### `zm remote-meetings update`

preview a meeting update; --yes performs it once

**Changes remote Zoom data.**

```sh
zm remote-meetings update <meeting> [options]
```

| Argument | | What it is |
|---|---|---|
| `meeting` | required | positive numeric Zoom meeting id. |

| Option | What it does |
|---|---|
| `--topic <text>` | meeting topic. |
| `--start-time <timestamp>` | ISO start time with timezone. |
| `--duration-minutes <minutes>` | positive meeting duration in minutes. |
| `--timezone <zone>` | IANA timezone. |
| `--agenda <text>` | meeting agenda. |
| `--type <type>` | instant (1) or scheduled (2). |
| `--yes` | apply the remote mutation once instead of previewing. |
| `--dry-run` | preview only, including when --yes is present. |

### `zm remote-meetings cancel`

preview a cancellation; --yes performs it once

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
| `--yes` | apply cancellation once instead of previewing. |
| `--dry-run` | preview only, including when --yes is present. |

## `zm skill`

the instructions an agent is given for this tool

### `zm skill show`

print SKILL.md — `zm skill install` puts it where Claude Code, Codex and Gemini CLI look for it

```sh
zm skill show
```

### `zm skill install`

write SKILL.md to \~/.claude/skills/zoom-cli/ (Claude Code) and \~/.agents/skills/zoom-cli/ (Codex, Gemini CLI)

**Changes local data.**

```sh
zm skill install [options]
```

| Option | What it does |
|---|---|
| `--for <agents>` | which agents to install for. One of: `claude`, `agents`, `all`. Default: `all`. |

## `zm serve`

serve read-only meeting tools over MCP stdio

```sh
zm serve [options]
```

| Option | What it does |
|---|---|
| `--mcp` | use the MCP JSON-RPC protocol. |
| `--unified-search` | include selected-profile meetings-only unified search. |
| `--meeting-context` | include account-fixed evidence, person context and task proposals. |
| `--semantic` | include read-only meeting vector search with an explicit query model. |
| `--model <id>` | explicit installed query model, or remote model at --base-url. |
| `--base-url <url>` | explicit remote embedding endpoint for semantic queries. |
| `--dims <count>` | remote embedding dimensions. |

## `zm search`

opt-in shared store search; meetings by default

### `zm search all`

meeting word prefixes plus selected resources; notes are store-global; JSONL emits one complete report

```sh
zm search all <query> [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | required |  |

| Option | What it does |
|---|---|
| `--only <resources>` | comma-separated meetings,messages,mail,notes (default meetings). |
| `--limit <items>` | result bound 1 through 1000 (default 100). Default: `100`. |
| `--max-meetings <count>` | candidate meeting scan bound 1 through 1000 (default 100). Default: `100`. |
| `--meeting-cursor <json>` | source-only continuation from meetings.nextCursor. |
| `--exact` | request exact matching; unsupported meeting queries are reported as skipped. |

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
