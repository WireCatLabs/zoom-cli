# Usage

What each command group does, and how output, deadlines and cancellation behave for scripts and
agents. [Every command and option](commands.md) is generated from the program.

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
| `recordings schedule create\|list\|show\|run\|disable` | plan and manage local daily archive jobs |
| `recordings archive inspect\|verify\|locks <directory>` | inspect local manifests, checksums or locks |
| `recordings archive recover <directory>` | preview recovery of stale local locks |
| `recordings archive transcript <directory>` | read verified archived WebVTT cues without a database |
| `recordings archive search <directory> <query>` | search verified archived cue text without a database |
| `recordings archive import <directory>` | verify archived VTT assets and append them to stored occurrences |
| `remote-meetings list\|show\|invitation` | read upcoming Zoom meetings and invitations |
| `remote-meetings create\|update\|cancel` | preview or apply a simple Zoom meeting change |
| `serve --mcp` | serve read-only stored meeting tools over MCP stdio |
| `skill show`, `skill install --for agents` | print or explicitly install the packaged agent guide |

Stored `meetings` commands use local database ids; `remote-meetings` uses Zoom's numeric ids.
[Managing Zoom meetings](remote-meetings.md) covers the write commands.

## Output for scripts and agents

Use `--json` for one JSON value or `--jsonl` for one item per line. Errors go to stderr. Use `--quiet`
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
