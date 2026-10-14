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

## Choose local or remote data

| Need | Command family | Where it works |
|---|---|---|
| Read saved transcripts and evidence | `meetings`, `events`, `search` | Local shared database |
| Retrieve hosted meeting data | `meetings sync`, API `watch` | Zoom to local database |
| Import transcript files | `meetings import`, folder `watch` | Local files to database |
| Back up available recording assets | `recordings` | Zoom to the destination you name |
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
| `recordings download <meeting> --destination <directory>` | archive available recording files |
| `recordings sync --since-time <date> --until-time <date> --destination <directory> --jsonl` | archive recording history across calendar months |
| `recordings schedule create\|list\|show\|run\|disable` | plan and manage local daily archive jobs |
| `recordings archive show\|check\|locks <directory>` | inspect local manifests, checksums or locks |
| `recordings archive recover <directory>` | preview recovery of stale local locks |
| `recordings archive transcript <directory>` | read verified archived WebVTT cues without a database |
| `search meetings <query> --archive <directory>` | search verified archived cue text without a database |
| `recordings archive import <directory>` | verify archived VTT assets and append them to stored occurrences |
| `remote-meetings list\|show\|invitation` | read upcoming Zoom meetings and invitations |
| `remote-meetings create\|update\|cancel` | preview or apply a simple Zoom meeting change |
| `serve --mcp` | serve read-only stored meeting tools over MCP stdio |
| `skill show`, `skill install --for agents` | print or explicitly install the packaged agent guide |

Stored `meetings` commands use local database ids; `remote-meetings` uses Zoom's numeric ids.
[Managing Zoom meetings](remote-meetings.md) covers the write commands.

## Output for scripts and agents

Use `--json` for one JSON value. `--jsonl` streams ordinary items one per line; stored meeting lists
and bounded participant pages keep one complete envelope per line so continuation and coverage survive. Errors go to stderr. Use `--quiet`
to suppress non-error diagnostics. Piped output defaults to JSON; terminal output uses the shared
human-readable renderer. Completion emits its shell protocol unless JSON is requested.

Use `--fields id,title` to select result fields. `--offline` refuses network requests. Finite commands
buffer successful output until resource cleanup completes, with a default output limit of 4 MiB;
`--max-output-bytes 0` removes that limit.

## Deadlines and cancellation

`--timeout <milliseconds>` sets a positive whole-command deadline. Durations also accept units such
as `30s`, `5m` and `1h`. Defaults are 30 seconds for reads, five minutes for login and one hour for
recording downloads, sync and archive verification. Foreground watching and MCP serving have no
default deadline. Cancellation waits for active operations and cleanup; an injected operation that
ignores its signal can delay shutdown.
