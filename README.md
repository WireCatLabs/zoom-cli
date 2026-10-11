# zoom-cli

**Zoom meetings and transcripts for your AI agent.** Know the context before the call. Remember the
commitments after it.

`zm` keeps your Zoom meetings, transcripts and AI summaries in a local database and gives them to
Claude Code, Codex, Gemini CLI or any MCP client. Ask what you discussed with someone last time, or
what you promised in yesterday's call, and get the answer with a reference to the exact passage.

[Documentation](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/index.md) ·
[Commands](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/commands.md) ·
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
zm meetings search "quote" --since 2026-09-01 --json
zm meetings evidence meeting:1/42/57/118 --json     # the exact passage
```

> **Agent:** You last spoke on 2 October in "Pricing review". You promised Bob a revised quote by
> Friday (`meeting:1/42/57/118`), and he asked whether the annual plan includes onboarding
> (`meeting:1/42/57/131`). Neither comes up in a later meeting.

## Quick start

You need Node 22.16+ (22.x) or 24+, a system keyring and **your own Zoom app** — Zoom lets a program
read your meetings only through an app you register. [Creating it](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/zoom-app.md)
takes a few minutes and needs no client secret.

```sh
npm install -g @wirecat/zoom-cli
zm config set zoom.clientId <public-client-id>
zm login                                  # approve in your browser; the token goes to the keyring
zm config set account.profile personal    # a label for your stored meetings
zm pull --lookback-days 7
zm meetings list
```

Turn on **Allow hosts to retain transcripts** in Zoom's settings first: Zoom returns transcripts only
for meetings you hosted, and only when they were kept. For meetings you only attended, download the
transcripts from Zoom and run `zm import <folder>`. Full guide:
[installation](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/installation.md).

## What you can do

**Prepare for a call.** *"Who is on my next call, and what did we talk about last time?"*
`remote-meetings list` shows upcoming meetings; `meetings people`, `meetings search` and
`meetings context person:<id>` bring back past meetings with the same people.

**Follow up after it.** *"What did I promise in today's call?"* The agent reads
`meetings transcript` and `meetings summary`, cites passages with `meetings evidence`, and
`meetings task-proposal --kind promise` previews a follow-up task tied to that passage.

**Keep the whole history.** *"Back up every recording since January."*
`recordings sync --from 2026-01-01 --to 2026-10-10 --destination ./zoom-archive --jsonl` downloads
video, audio, transcripts and chat with SHA-256 manifests; `recordings schedule` runs it daily.

## Built for AI agents

- **Command line + skill.** `zm skill install` adds the packaged guide for Claude Code, Codex and
  Gemini CLI. Every command speaks `--json` or `--jsonl`, and `zm commands --json` describes them all.
- **MCP.** `zm serve --mcp` is a read-only stdio server for Claude Desktop, Cursor and other MCP
  clients: meetings, transcripts, summaries, exports and search.
  [Connecting a client](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/mcp.md).

Your agent. Your meetings. Your rules.

## Why zm

- **Context, not one transcript.** Every meeting you hosted, transcripts you imported and recordings
  you archived, searchable together.
- **Local-first.** Meetings live in a SQLite database on your machine. Archived transcripts can be read
  and searched offline, without login.
- **Every answer has a source.** References such as `meeting:1/42/57/118` point to one passage of one
  transcript revision, and corrected transcripts keep their history.
- **Made for agents.** JSON output, bounded reads with explicit completeness, a skill and an MCP server.
- **Safe by default.** Your own Zoom app, tokens only in the keyring, a read-only MCP server, and every
  change to Zoom previewed until you add `--yes`.

## What works today, and what does not yet

`zm` is at version 0.x; commands may still change. Today it reads hosted meetings, participants,
transcripts and AI summaries (Pro plan or higher) through Zoom's official API, imports downloaded
WebVTT files, archives cloud recordings, and creates, changes or cancels simple meetings.

- **It does not find commitments on its own.** Your agent finds them in transcripts;
  `task-proposal` only previews a task and creates nothing.
- **Person context is partial.** It relies on identity links already in the shared store, and `zm`
  never guesses a person from a speaker name.
- **Attended meetings need a manual download** from your Zoom portal, then `zm import`.
- **A company-managed Zoom account** may need an admin to approve your app.
- **Daily archive jobs install only on Linux.** Other platforms can preview them.
- **Zoom only, for now.** Google Meet and Microsoft Teams are
  [on the roadmap](https://github.com/WireCatLabs/cli-meetings/blob/main/docs/dev/ROADMAP.md).

## Part of WireCat

`zm` is part of [WireCat](https://wirecat.dev), an open-source, local-first context layer for AI
agents. Meetings land in the same local store as your Telegram, MAX and memo data, so
`zm search all "<query>" --only meetings,messages,notes` can search them together. Start with Zoom.
Add more context when you need it. Your context. Any agent.

## Documentation

| Page | What it covers |
|---|---|
| [Installation](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/installation.md) | requirements, first run, where files go |
| [Your Zoom app](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/zoom-app.md) | creating the app, scopes, company accounts |
| [Sessions](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/sessions.md) | login, keyring, local profiles |
| [Usage](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/usage.md) | every command group, output, deadlines |
| [The local archive](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/archive.md) | pull, import, watch, recording backups |
| [Search and evidence](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/search.md) | search, evidence, person context, task proposals |
| [Topic search](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/topic-search.md) | search by meaning with a model you choose |
| [MCP and skills](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/mcp.md) | connecting agents and MCP clients |
| [Managing Zoom meetings](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/remote-meetings.md) | upcoming meetings, create, update, cancel |
| [Commands](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/commands.md) · [Configuration](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/configuration.md) | every command, option and setting |
| [Troubleshooting](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/troubleshooting.md) | by symptom |

## Security

- Login uses PKCE with your own app; there is no client secret.
- Tokens live only in the system keyring, never in a config file.
- Recording manifests never hold signed download URLs or tokens.
- The MCP server is read-only and fixed to your selected local account.

More in [security](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/security.md).

## Contributing

[Development setup](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/dev/DEVELOPMENT.md),
[architecture](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/dev/ARCHITECTURE.md) and
[testing](https://github.com/WireCatLabs/zoom-cli/blob/main/docs/dev/TESTING.md). Fixtures use
invented people and meetings only.

## Licence

[Apache License 2.0](https://github.com/WireCatLabs/zoom-cli/blob/main/LICENSE).
