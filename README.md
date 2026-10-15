<p align="center">
  <img src="https://raw.githubusercontent.com/WireCatLabs/zoom-cli/main/docs/images/social-preview.png" alt="Zoom meetings and transcripts for your AI agent" width="100%">
</p>

# zoom-cli

**Zoom meetings and transcripts for your AI agent.** Know the context before the call. Remember the
commitments after it.

`zm` keeps your Zoom meetings, transcripts and AI summaries in a local database and gives them to
Claude Code, Codex, Gemini CLI or any MCP client. Ask what you discussed with someone last time, or
what you promised in yesterday's call, and get the answer with a reference to the exact passage.

[Documentation][docs/index.md] ·
[Commands][docs/commands.md] ·
[WireCat](https://wirecat.dev)

[![npm](https://img.shields.io/npm/v/@wirecat/zoom-cli)](https://www.npmjs.com/package/@wirecat/zoom-cli)
[![Node](https://img.shields.io/node/v/@wirecat/zoom-cli)](https://nodejs.org/)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/WireCatLabs/zoom-cli/blob/main/LICENSE)

<!-- Demo slot: a 30–45 s recording of the exchange below goes here, as an absolute
     raw.githubusercontent.com URL so it also renders on npmjs.com. -->

**Example** — invented people, illustrative output:

> **You:** I have a call with Bob Sample at three. What did we agree last time, and what do I owe him?

```sh
zm remote-meetings list --json                      # your upcoming meetings
zm meetings people "Bob Sample" --json              # him among past participants
zm search meetings "quote" --since-time 2026-09-01 --json
zm meetings passage meeting:1/42/57/118 --format markdown  # the line and its context
```

> **Agent:** You last spoke on 2 October in "Pricing review". You promised Bob a revised quote by
> Friday (`meeting:1/42/57/118`), and he asked whether the annual plan includes onboarding
> (`meeting:1/42/57/131`). Neither comes up in a later meeting.

## Quick start

You need Node 22.16+ (22.x) or 24+, a system keyring and **a configured user-managed Zoom app**. Reuse one you already created or one your team
has made available to your user; otherwise [create your own][docs/zoom-app.md]. Use its Public
Client ID, not its regular Client ID or secret. The [installation guide][docs/installation.md]
walks through app settings, browser approval and callback completion.

```sh
npm install -g @wirecat/zoom-cli
zm config set zoom.client_id <public-client-id>
zm session start                          # approve in your browser; the token goes to the keyring
zm config set account.profile personal    # a label for your stored meetings
zm meetings sync --lookback-days 7
zm meetings list
```

Check Zoom's transcript generation and retention settings first: the API reads available hosted
meeting text, and permission does not create a transcript. For an attended meeting, obtain a VTT
file from the host or download one if allowed, then run `zm meetings import <folder>`. Full guide:
[installation][docs/installation.md].

More: [installation][docs/installation.md] · [your Zoom app][docs/zoom-app.md] ·
[Zoom on wirecat.dev][wirecat/en/docs/zoom]

## What you can do

**Prepare for a call.** *"I meet Bob Sample tomorrow. What did we talk about last time?"*
`remote-meetings list` shows upcoming meetings; `meetings people`, `search meetings` (word
search that also matches English, Spanish and Russian word forms) and `meetings context person:<id>`
bring back past meetings with the same people.
Participant discovery accepts `--limit`, `--scan-limit`, `--max-read-bytes` and `--cursor`;
follow `page.next` even after an empty scan page. It returns observed `identity_id` candidates,
never inferred person links. Stored meeting lists accept metadata queries, for example
`zm meetings list 'started_at:[2026-09-01 TO 2026-10-01]' --json`.

**Follow up after it.** *"What did I promise in today's call?"* The agent reads
`meetings transcript` and `meetings summary`, cites passages with `meetings evidence`, and
`meetings task-proposal --type promise` previews a follow-up task tied to that passage.

**Keep the whole history.** *"Back up every recording since January."*
`recordings sync --since-time 2026-01-01 --until-time 2026-10-10 --output-dir ./zoom-archive --jsonl` downloads
video, audio, transcripts and chat with SHA-256 manifests; `recordings schedule` runs it daily.

More: [the local archive][docs/archive.md] · [search and evidence][docs/search.md] ·
[Zoom on wirecat.dev][wirecat/en/docs/zoom]

## Built for AI agents

- **Command line + skill.** `zm skill install` adds the packaged guide for Claude Code, Codex and
  Gemini CLI. Every command speaks `--json` or `--jsonl`, and `zm commands --json` describes them all.
- **MCP.** `zm serve --mcp` is a read-only stdio server for Claude Desktop, Cursor and other MCP
  clients: meetings, transcripts, summaries, exports and search.
  [Connecting a client][docs/mcp.md].

Your agent. Your meetings. Your rules.

More: [MCP and skills][docs/mcp.md] · [connect your AI agent][wirecat/en/docs/agents]

## Why zm

- **Context across meetings.** Search available hosted meetings and imported transcripts in the shared
  store. Read archived transcripts separately or import them before searching them together.
- **Local-first.** Meetings live in a SQLite database on your machine. Archived transcripts can be read
  and searched offline, without login.
- **Every answer has a source.** References such as `meeting:1/42/57/118` point to one passage of one
  transcript revision, and corrected transcripts keep their history.
- **Made for agents.** JSON output, bounded reads with explicit completeness, a skill and an MCP server.
- **Safe by default.** Your own Zoom app, tokens only in the keyring, a read-only MCP server, and every
  change to Zoom previewed until you add `--yes`.

More: [security][docs/security.md] · [Zoom on wirecat.dev][wirecat/en/docs/zoom]

## What works today, and what does not yet

`zm` is at version 0.x; commands may still change. Today it reads hosted meetings, participants,
transcripts and AI summaries available to the account through Zoom's official API, imports downloaded
WebVTT files, archives cloud recordings, transcribes local audio with an installed speech model,
links meetings to events and people, and creates, changes or cancels simple meetings.

- **It does not find commitments on its own.** Your agent finds them in transcripts;
  `task-proposal` only previews a task and creates nothing.
- **People are linked by hand.** `zm` never guesses a person from a speaker name; person context
  covers participants already linked to a person, for example with `meetings link`.
- **Local transcription takes PCM16 WAV only** (16 or 48 kHz) and an already installed speech model;
  video files are not decoded, and speakers stay unknown.
- **Attended meetings need a manual download** from your Zoom portal, then `zm meetings import`.
- **A company-managed Zoom account** may need an admin to approve your app.
- **Daily archive jobs install only on Linux.** Other platforms can preview them.
- **Zoom only, for now.** Google Meet and Microsoft Teams are
  [on the roadmap][gh/cli-meetings/blob/main/docs/dev/roadmap.md].

More: [what is planned][gh/cli-meetings/blob/main/docs/dev/roadmap.md] · [Zoom on wirecat.dev][wirecat/en/docs/zoom]

## Commands by task

| Task | Commands |
|---|---|
| Set up and log in | `config show`, `config set <key> <value>`, `session start [--browser <program>]`, `session status [--check]`, `doctor` |
| Bring meetings in | `meetings sync [--since-time <time>] [--lookback-days <days>]`, `meetings import <folder>`, `watch [api\|files] [folder] --jsonl` |
| Read stored meetings | `meetings list`, `meetings show <meeting>`, `meetings transcript <meeting>`, `meetings summary <meeting>`, `meetings export <meeting> --format markdown\|vtt`, `events list` |
| Search | `search meetings <query>`, `meetings people <query>`, `search all <query>` |
| Evidence and people | `meetings passage <reference>`, `meetings evidence <reference>`, `meetings context <person>`, `meetings link <reference>`, `meetings update <reference>`, `meetings task-proposal <reference> --type <type>` |
| Search by meaning | `search meetings <query> --model <model>`, `meetings embeddings --model <model>` |
| Local transcription | `meetings transcribe <meeting> <file> --model <model>` |
| Cloud recordings | `recordings list`, `recordings show <meeting>`, `recordings download <meeting> --output-dir <dir>`, `recordings sync --since-time <date> --until-time <date> --output-dir <dir> --jsonl`, `recordings schedule create\|list\|show\|run\|disable` |
| Local archive | `recordings archive show\|check\|locks\|recover <directory>`, `recordings archive transcript\|import <directory>`, `search meetings <query> --archive <directory>` |
| Zoom meetings | `remote-meetings list\|show\|invitation`, `remote-meetings create\|update\|cancel` |
| Agents | `serve --mcp`, `skill show`, `skill install [--for claude\|agents\|all]`, `commands --json`, `complete -- <words...>` |

Zoom meeting changes, links, transcription, schedules, explicit `meetings embeddings` generation and
lock recovery preview by default and run once with `--yes`; `--dry-run` keeps the preview. Word search
updates its index automatically. Search with `--model` generates missing vectors before ranking; an
explicitly selected remote embedding endpoint receives those transcript passages and the query.

More: [usage][docs/usage.md] · [every command and option][docs/commands.md] · [Zoom on wirecat.dev][wirecat/en/docs/zoom]

## Your Zoom app and login

`zm` reads your meetings through Zoom's official API using a **configured user-managed Zoom app**
with Public Client OAuth. Reuse an existing app available to your user or create one. Enable Public
Client OAuth, copy its Public Client ID, configure the redirect and add the required scopes manually.
The optional starter manifest supplies neither scopes nor Public Client OAuth. Zoom may show a
Client Secret, but `zm` does not use it. Recording archives and management need additional scopes.
Follow the [app setup guide][docs/zoom-app.md]; no credentials file is downloaded.

`zm session start` opens Zoom's consent page. Zoom redirects to the static page
`https://wirecat.dev/zoom-callback`, which passes the answer to a listener on your machine; if it
cannot, paste the `code=…&state=…` parameters it shows. Login checks the state and PKCE verifier and
stores tokens only in the system keyring. Browser login needs an interactive terminal; piped or JSON
login also needs `--interactive`. `zm session status` reads the cached state without refreshing it;
`--check` asks Zoom.

More: [your Zoom app][docs/zoom-app.md] · [login and sessions][docs/sessions.md] ·
[Zoom on wirecat.dev][wirecat/en/docs/zoom]

## Profiles and the local store

`account.profile` is a label (1–64 letters, digits, dots, underscores or hyphens) that groups the
meetings you store; use separate labels for data you want kept apart. Import and pull register the
profile; read commands never do, so pull or import first.

Meetings live in the shared WireCat database `wirecat.db`, next to data from other WireCat tools.
`MESSAGING_STORE` selects another path. Opening the default path deletes the legacy unencrypted
`messages.db` and its sidecars without migrating them, unless another path is set or another process
holds it open. Metadata, help, configuration and login never open the database.

More: [profiles][docs/sessions.md#select-a-local-profile] ·
[where meetings are stored][docs/archive.md#where-meetings-are-stored] · [Zoom on wirecat.dev][wirecat/en/docs/zoom]

## Pull, import and watch

```sh
zm meetings sync --lookback-days 7                       # hosted meetings, revisiting late transcripts
zm meetings import ./downloaded-transcripts              # .vtt files from your Zoom portal
zm watch api --lookback-days 7 --jsonl                   # keep pulling in the foreground
```

The cursor alone does not revisit transcripts that appear late; use `--lookback-days` or an older
`--since-time`. A failed occurrence leaves the cursor unchanged for the next pull. Imported files follow
the exporter's `YYYY-MM-DD_HHMM_topic-slug.vtt` names; set `files.timezone` to the zone they were
written in (UTC by default). Participants of imported files stay unknown, and speaker names are
never turned into identities.

More: [the local archive][docs/archive.md] · [Zoom on wirecat.dev][wirecat/en/docs/zoom]

## Archive cloud recordings

```sh
zm recordings sync --since-time 2026-01-01 --until-time 2026-10-10 --output-dir ./zoom-archive --jsonl
zm recordings archive check ./zoom-archive --offline --json
zm search recordings ./zoom-archive "example plan" --offline --json
```

Sync covers up to ten years in monthly requests and downloads serially, streaming to disk. Each
occurrence gets a manifest with sizes and SHA-256 checksums, never signed URLs or tokens. Existing
files are never overwritten; repeated runs skip verified files. With a profile, interrupted downloads
resume safely. `recordings archive transcript` and `search meetings --archive` read verified WebVTT offline
without a database; `recordings archive import` appends them to your stored meetings. `recordings schedule
create --yes` installs a daily systemd user timer (Linux only).

What you can download depends on Zoom permissions, retention and your plan. Recordings of meetings
you only attended are not necessarily available through your API.

More: [archive cloud recordings][docs/archive.md#archive-cloud-recordings] ·
[daily backups][docs/archive.md#daily-backups] · [Zoom on wirecat.dev][wirecat/en/docs/zoom]

## Search and evidence

```sh
zm search meetings "example plan" --limit 20 --json       # word search with continuation
zm meetings evidence meeting:3/15/20/0 --cues 100 --json  # the exact passage
zm meetings context person:7 --meetings 10 --json         # meetings linked to a person
```

`search meetings` indexes new meetings first, matches every word by prefix or by stored English, Spanish
and Russian word forms, and pages with an opaque `--cursor`. References have the form
`meeting:<account>/<meeting>[/<transcript>[/<cue-position>]]`, stay inside the selected account and
keep pointing at the same revision after a correction. Bounded reads report their
coverage and limits; archive completeness can remain unknown. `search all --only meetings,notes` adds store-wide notes. `search meetings
--model` searches by meaning with a model you name; nothing is downloaded for you.

More: [search and evidence][docs/search.md] · [topic search][docs/topic-search.md] ·
[Zoom on wirecat.dev][wirecat/en/docs/zoom]

## Local transcription

No Zoom transcript? `zm meetings transcribe 1 ./call.wav --model <model> --yes` recognizes a PCM16 WAV
file (mono or stereo, 16 or 48 kHz) with an already installed local speech model and appends it as a
separate transcript. The preview checks the file without loading the model. Timestamps cover windows
of up to 30 seconds and speakers stay unknown.

More: [transcribe local audio][docs/archive.md#transcribe-local-audio] · [Zoom on wirecat.dev][wirecat/en/docs/zoom]

## MCP and agent setup

`zm skill install` writes the packaged guide to `~/.claude/skills/zoom-cli/` (Claude Code) and
`~/.agents/skills/zoom-cli/` (Codex, Gemini CLI); `--for` picks one. MCP clients start the server
with `["serve", "--mcp"]`:

```json
{ "mcpServers": { "zoom": { "command": "zm", "args": ["serve", "--mcp"] } } }
```

The server has seven read-only tools: meeting list and show, transcripts, summaries, exports, text
search and participant search. `--meeting-context`, `--unified-search` and `--semantic --model <model>`
enable cited passages, shared search and ranking of existing semantic vectors. It reads only the selected profile, and never exposes
file exports, Zoom changes, embedding generation or task creation. A desktop app may need the full
path from `command -v zm` (Linux/macOS) or `where.exe zm` (Windows), and the same `ZM_CONFIG_DIR` or `MESSAGING_STORE` in the entry's `env`.

More: [MCP and skills][docs/mcp.md] · [MCP and skills on wirecat.dev][wirecat/en/docs/mcp] ·
[connect your AI agent][wirecat/en/docs/agents]

## Manage Zoom meetings

```sh
zm remote-meetings create --title "Example planning" --start-time 2026-10-20T10:00:00Z --duration-minutes 30 --json
zm remote-meetings cancel 123456789 --dry-run --json
```

Creation, updates and cancellation preview until you add `--yes`, and are never retried
automatically. An uncertain outcome exits with code 14: check Zoom before repeating. Remote ids are
Zoom's numeric ids; stored `meetings` commands use local ids.

More: [managing Zoom meetings][docs/remote-meetings.md] · [Zoom on wirecat.dev][wirecat/en/docs/zoom]

## Output, limits and deadlines

`--json` prints one answer envelope; `--jsonl` prints typed item records and a final end record; piped output defaults to JSON and errors
go to stderr. `--json=id,title` keeps only those fields, `--offline` refuses the network, and output is
capped at 4 MiB unless `--max-output-bytes` says otherwise. Default deadlines are 30 seconds for
reads, five minutes for login and one hour for downloads, sync and verification; `--timeout 5m`
changes them. Watching and MCP serving run until stopped.

More: [usage][docs/usage.md] · [Zoom on wirecat.dev][wirecat/en/docs/zoom]

## Configuration

| Setting | Meaning |
|---|---|
| `zoom.client_id` | your Zoom app's Public Client ID |
| `account.profile` | the local profile label |
| `source` | `api` or `files` for `meetings sync` and `watch` |
| `files.folder`, `files.timezone` | the transcript folder and the zone of its filenames |
| `ZM_CONFIG_DIR` | another configuration directory (also changes the keyring entry) |
| `MESSAGING_STORE` | another shared database path |
| `OPENAI_API_KEY` | only for an OpenAI embedding endpoint you select |

More: [configuration][docs/configuration.md] · [Zoom on wirecat.dev][wirecat/en/docs/zoom]

## Security model

- A configured Zoom public-client app with PKCE; no client secret is used.
- Tokens only in the system keyring, never in a config file; a missing keyring is an error.
- Network: Zoom's API, plus an embedding endpoint only when you name one. `--offline` refuses both.
- Manifests and saved jobs never hold signed URLs, tokens or credentials; diagnostics omit raw
  provider error text.
- The MCP server is read-only and fixed to the selected profile; changes to Zoom preview until `--yes`.

More: [security][docs/security.md] · [security on wirecat.dev][wirecat/en/docs/security]

## Troubleshooting

- **"Invalid redirect" from Zoom:** the manifest import left the redirect URL or Public Client OAuth
  unset; fill them in by hand.
- **No transcripts:** check generation, retention and permissions in the [app guide][docs/zoom-app.md].
  Enabling a setting does not restore deleted text; attended meetings may need `zm meetings import`.
- **Missing-scope error:** add the named scope in your app, then `zm session start` again.
- **Browser does not start:** `zm session start --browser firefox`, or paste the callback parameters.
- **Lock left after a crash:** `zm recordings archive locks`, then `recover` with `--yes`.

More: [troubleshooting][docs/troubleshooting.md] · [Zoom on wirecat.dev][wirecat/en/docs/zoom]

## Part of WireCat

`zm` is part of [WireCat](https://wirecat.dev), an open-source, local-first context layer for AI
agents. Meetings land in the same local store as your Telegram, MAX and memo data, and
`zm search all "<query>" --only meetings,notes` searches them together with your memo notes.
Start with Zoom. Add more context when you need it. Your context. Any agent.

More: [wirecat.dev](https://wirecat.dev) · [connect your AI agent][wirecat/en/docs/agents]

## Technical docs

| Page | What it covers |
|---|---|
| [Overview][docs/index.md] | what `zm` is and the one-minute start |
| [Installation][docs/installation.md] | requirements, first run, where files go, completion |
| [Your Zoom app][docs/zoom-app.md] | creating the app, scopes, company accounts |
| [Login, sessions and profiles][docs/sessions.md] | OAuth login, keyring, local profiles |
| [Usage][docs/usage.md] | every command group, output, deadlines |
| [The local archive][docs/archive.md] | pull, import, watch, recordings, backups, transcription |
| [Search and evidence][docs/search.md] | word search, evidence, people, links, memo |
| [Topic search][docs/topic-search.md] | search by meaning with a model you choose |
| [MCP and skills][docs/mcp.md] | the skill, the MCP server, optional tools |
| [Managing Zoom meetings][docs/remote-meetings.md] | upcoming meetings, create, update, cancel |
| [Commands][docs/commands.md] | every command, option and exit code (generated) |
| [Configuration][docs/configuration.md] | settings and environment variables |
| [Troubleshooting][docs/troubleshooting.md] | by symptom |
| [Security][docs/security.md] | what reaches the disk and the network |
| [Architecture][docs/dev/architecture.md] · [Testing][docs/dev/testing.md] · [Releasing][docs/dev/releasing.md] | for contributors |

The [Zoom guides on wirecat.dev][wirecat/en/docs/zoom] include setup, search and archive instructions.

## Development

Node 22.16 or newer within 22.x, or Node 24 or newer:

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check
pnpm build && pnpm smoke:bun
```

Fixtures use invented people and meetings. Tests use an injected keyring, scripted HTTP responses,
temporary config folders and the memory meeting store. `pnpm generate:check` checks the generated
command reference; `pnpm test:matrix` measures command and option coverage.

More: [development setup][docs/dev/development.md] · [test matrix][docs/dev/test-matrix.md]

## Licence

[Apache License 2.0][license].

[docs/archive.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/archive.md
[docs/archive.md#archive-cloud-recordings]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/archive.md#archive-cloud-recordings
[docs/archive.md#daily-backups]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/archive.md#daily-backups
[docs/archive.md#transcribe-local-audio]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/archive.md#transcribe-local-audio
[docs/archive.md#where-meetings-are-stored]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/archive.md#where-meetings-are-stored
[docs/commands.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/commands.md
[docs/configuration.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/configuration.md
[docs/dev/architecture.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/dev/ARCHITECTURE.md
[docs/dev/development.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/dev/DEVELOPMENT.md
[docs/dev/releasing.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/dev/RELEASING.md
[docs/dev/test-matrix.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/dev/test-matrix.md
[docs/dev/testing.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/dev/TESTING.md
[docs/index.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/index.md
[docs/installation.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/installation.md
[docs/mcp.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/mcp.md
[docs/remote-meetings.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/remote-meetings.md
[docs/search.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/search.md
[docs/security.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/security.md
[docs/sessions.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/sessions.md
[docs/sessions.md#select-a-local-profile]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/sessions.md#select-a-local-profile
[docs/topic-search.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/topic-search.md
[docs/troubleshooting.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/troubleshooting.md
[docs/usage.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/usage.md
[docs/zoom-app.md]: https://github.com/WireCatLabs/zoom-cli/blob/main/docs/zoom-app.md
[gh/cli-meetings/blob/main/docs/dev/roadmap.md]: https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/MEETINGS.md#providers-next
[license]: https://github.com/WireCatLabs/zoom-cli/blob/main/LICENSE
[wirecat/en/docs/agents]: https://wirecat.dev/en/docs/agents
[wirecat/en/docs/mcp]: https://wirecat.dev/en/docs/mcp
[wirecat/en/docs/security]: https://wirecat.dev/en/docs/security
[wirecat/en/docs/zoom]: https://wirecat.dev/en/docs/zm
