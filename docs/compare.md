# Compared with other tools

`zm` is a command line and an MCP server for the Zoom meetings of your own account. This page puts it next to the
other command lines, MCP servers and scripts that use a Zoom account through Zoom's API, so you can see which one
fits your job. The marks for `zm` come from its source code on `main` (version 0.40.0), checked on 24 October 2026. The
marks for the other tools come from their own READMEs and documentation, checked on 24 October 2026. Nothing was
logged in to or tested live, and a tool may do more than its pages say.

The tools:

- **zm**: this tool. Reads and archives the meetings of your Zoom account, searches what was said, and schedules
  meetings. It does not join calls.
- **[Zoom's MCP server](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md)**: the MCP
  server that Zoom hosts, with 9 tools, from the official [zoom/skills](https://github.com/zoom/skills) repository
  (updated 20 October 2026).
- **[zoom-cli by rvben](https://github.com/rvben/zoom-cli)**: a Rust command line for the Zoom API: meetings,
  recordings, users, webinars and reports (v0.2.9, updated 19 October 2026).
- **[zoom-agent-cli](https://github.com/bcharleson/zoom-agent-cli)**: a command line and MCP server for the Zoom API,
  61 commands (updated 8 September 2026).
- **[zoom-recording-downloader](https://github.com/ricardorodrigues-ca/zoom-recording-downloader)**: a Python script
  that downloads cloud recordings, the most starred of these tools (161 stars, updated 14 August 2026).
- **[@sweatco/zoom-mcp](https://github.com/sweatco/zoom-mcp)**: a community MCP server for meeting transcripts and
  AI summaries (updated 23 September 2026).

✅ yes · 🟡 partly · ❌ no · ➖ not in its documentation

## Features

| Task | zm | [Zoom MCP](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md) | [rvben](https://github.com/rvben/zoom-cli) | [zoom-agent-cli](https://github.com/bcharleson/zoom-agent-cli) | [Downloader](https://github.com/ricardorodrigues-ca/zoom-recording-downloader) | [@sweatco](https://github.com/sweatco/zoom-mcp) |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| **Transcripts** | | | | | | |
| Read the transcript of a meeting you hosted | ✅ | [✅](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md#get_recording_resource) | [✅](https://github.com/rvben/zoom-cli#recordings) | [✅](https://github.com/bcharleson/zoom-agent-cli#recordings-and-transcripts) | ➖ | [✅](https://github.com/sweatco/zoom-mcp#available-tools) |
| Read the transcript of a meeting someone else hosted | 🟡 | ➖ | ➖ | ➖ | ➖ | [🟡](https://github.com/sweatco/zoom-mcp#zoom-api-limitations) |
| **Search what was said** | | | | | | |
| Find the words said in a meeting | ✅ | [🟡](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md#search_meetings) | ➖ | [🟡](https://github.com/bcharleson/zoom-agent-cli#recordings-and-transcripts) | ➖ | [🟡](https://github.com/sweatco/zoom-mcp#features) |
| Find a meeting by what it was about, not by exact words | ✅ | [✅](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md#search_meetings) | ➖ | ➖ | ➖ | ➖ |
| Find another form of a word, in English, Russian and Spanish | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Open the exact lines behind a hit, with a reference that survives a corrected transcript | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Save a search and run it again later | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| **Find a meeting** | | | | | | |
| List meetings and find one by its title | ✅ | [✅](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md#search_meetings) | [✅](https://github.com/rvben/zoom-cli#meetings) | [✅](https://github.com/bcharleson/zoom-agent-cli#recordings-and-transcripts) | ➖ | [✅](https://github.com/sweatco/zoom-mcp#available-tools) |
| Find the meetings with a person, by name or email | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| **Summaries** | | | | | | |
| Read the AI summary that Zoom made | ✅ | [✅](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md#get_meeting_assets) | ➖ | [✅](https://github.com/bcharleson/zoom-agent-cli#meetings) | ➖ | [✅](https://github.com/sweatco/zoom-mcp#available-tools) |
| See the meetings since last week with next steps and who talked how long | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| **Schedule meetings** | | | | | | |
| Create a meeting | ✅ | [❌](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md#current-live-tools) | [✅](https://github.com/rvben/zoom-cli#meetings) | [✅](https://github.com/bcharleson/zoom-agent-cli#meetings) | ➖ | [❌](https://github.com/sweatco/zoom-mcp#available-tools) |
| Change or cancel a meeting | ✅ | [❌](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md#current-live-tools) | [✅](https://github.com/rvben/zoom-cli#meetings) | [✅](https://github.com/bcharleson/zoom-agent-cli#meetings) | ➖ | [❌](https://github.com/sweatco/zoom-mcp#available-tools) |
| **Archive** | | | | | | |
| Download the cloud recordings of a date range in one run | ✅ | [🟡](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md#recordings_list) | [🟡](https://github.com/rvben/zoom-cli#recordings) | [🟡](https://github.com/bcharleson/zoom-agent-cli#recordings) | [✅](https://github.com/ricardorodrigues-ca/zoom-recording-downloader#usage-) | ❌ |
| Check every downloaded file, and resume a stopped download | ✅ | ➖ | ➖ | ➖ | [🟡](https://github.com/ricardorodrigues-ca/zoom-recording-downloader#command-line-arguments-) | ➖ |
| Run the archive every day on a timer | 🟡 | ➖ | ➖ | ➖ | ➖ | ➖ |
| **Agents and safety** | | | | | | |
| MCP server | ✅ | [✅](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md) | ➖ | [✅](https://github.com/bcharleson/zoom-agent-cli#mcp-server) | ➖ | [✅](https://github.com/sweatco/zoom-mcp#available-tools) |
| Every command of the tool is also an MCP tool | 🟡 | ➖ | ➖ | [✅](https://github.com/bcharleson/zoom-agent-cli#mcp-server) | ➖ | ➖ |
| Limit an agent to reading | ✅ | [🟡](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md#supported-scope-families-advertised-by-zoom-mcp) | ➖ | [🟡](https://github.com/bcharleson/zoom-agent-cli#add-scopes) | ➖ | ➖ |
| Allow or deny single commands for an agent, per profile | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Ask first, or preview, before a meeting is changed | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Login kept only in the system keyring | ✅ | ➖ | [❌](https://github.com/rvben/zoom-cli#config-file) | [❌](https://github.com/bcharleson/zoom-agent-cli#interactive-login-local-cli) | [❌](https://github.com/ricardorodrigues-ca/zoom-recording-downloader#usage-) | [🟡](https://github.com/sweatco/zoom-mcp#privacy--data) |
| Instructions for agents that use a terminal | ✅ | [✅](https://github.com/zoom/skills) | ➖ | ➖ | ➖ | ➖ |
| **Setup** | | | | | | |
| Start without creating your own Zoom app | ❌ | [❌](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/SKILL.md) | [❌](https://github.com/rvben/zoom-cli#config-file) | [❌](https://github.com/bcharleson/zoom-agent-cli#create-the-app) | [❌](https://github.com/ricardorodrigues-ca/zoom-recording-downloader#usage-) | [🟡](https://github.com/sweatco/zoom-mcp#quick-start-basic-setup) |
| Several Zoom accounts | ✅ | ➖ | [✅](https://github.com/rvben/zoom-cli#config-file) | ➖ | ➖ | ➖ |

| | zm | Zoom MCP | rvben | zoom-agent-cli | Downloader | @sweatco |
|---|---|---|---|---|---|---|
| Install | npm, Node 22.16 or later | none: Zoom hosts it | cargo, pip or a release file | npm or npx | clone it, then pip | npx |
| Licence | Apache-2.0 | closed service; the skills repo is MIT | MIT | MIT | MIT | MIT |

Notes on the `zm` column:

- **Your own Zoom app.** Today every user of `zm` creates a Zoom app in the Zoom App Marketplace, or uses one that a
  colleague shares. No shared app works without setup yet. Follow [the app guide](zoom-app.md). The app is
  user-managed: you sign in as yourself, and the app does not need an administrator's credentials. The READMEs of
  rvben, zoom-agent-cli and the downloader ask for a Server-to-Server OAuth app instead.
- **Meetings someone else hosted.** `zm` reads meetings that your account hosts or scheduled. For a meeting you only
  attended, get the transcript file from the host and run `meetings import`.
- **Find a meeting by what it was about.** It needs an embedding model that you choose. Without one, search matches
  words.
- **Summaries.** `zm` reads the AI summary that Zoom made. It makes no summary of its own.
- **Every command also an MCP tool.** `zm` offers its commands through three MCP tools. A few stay in the terminal:
  `watch`, `session start`, `meetings scheduled`, `meetings projects scan` and `upgrade`.
- **Limits and questions.** A profile can deny a command or allow only commands that change nothing. Changes to Zoom
  meetings ask first at a terminal. Over MCP no one is there to answer, so a profile that must not change Zoom sets
  `{"remote-meetings": "readonly"}`. See [MCP and skills](mcp.md).
- **Daily archive.** The timer installs on Linux only. Other systems can preview it.
- **Speed and cost against a browser agent.** `zm` calls Zoom's API and opens no browser. No measurement of it against
  a browser agent is published, so this page makes no claim.

## When another tool fits better

- **Zoom's MCP server**: you want an AI app to ask Zoom about meetings, Team Chat messages and Zoom Docs together,
  with nothing to install.
- **rvben or zoom-agent-cli**: you administer an account and need users, webinars, reports or, with zoom-agent-cli,
  Team Chat and the quality dashboard. `zm` does not manage those.
- **zoom-recording-downloader**: you want every user's recordings of a Business account, or a copy in Google Drive.
- **@sweatco/zoom-mcp**: your organisation will run its proxy, so that people can read meetings they attended and
  not only those they hosted.

If `zm` fits, start with [installation](installation.md). To connect an agent, see [MCP and skills](mcp.md).
