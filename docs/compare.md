# Compared with other tools

Several tools turn Zoom meetings into text for you or for an AI agent. This page puts `zm` next to seven of them, so
you can see which tool does what and pick the one that fits your job. The marks for `zm` come from its source code,
checked on 24 October 2026. The marks for the other tools come from their public pricing pages, documentation and
READMEs, checked on 23 October 2026. Nothing was logged in to or tested live, and a tool may do more than its pages
say.

The tools:

- **zm**: this tool. A command line and an MCP server for the Zoom meetings of your account, with a local archive.
- **[Zoom](https://zoom.us/pricing/aic)**: Zoom itself, with its AI Companion (now called ZoomMate), cloud recording
  transcripts and a hosted MCP server.
- **[Otter.ai](https://otter.ai/pricing)**: a note taker with its own transcription and an MCP server.
- **[Fireflies.ai](https://fireflies.ai/pricing)**: a meeting bot with an MCP server.
- **[Granola](https://www.granola.ai/pricing)**: notes made from your device audio, with an MCP server.
- **[Fathom](https://www.fathom.ai/pricing)**: a meeting bot with an API and an MCP server.
- **[tl;dv](https://tldv.io/pricing/)**: a meeting bot and a desktop recorder, with an MCP server.
- **[Vexa](https://github.com/Vexa-ai/vexa)**: open source meeting bots that you host yourself, for Meet, Teams and
  Zoom.

✅ yes · 🟡 partly · ❌ no · ➖ not in its documentation

## Two facts about zm

- **Every user creates their own Zoom app.** `zm` signs in through a Zoom app that you create in the Zoom App
  Marketplace, or one that your team has made available to you. There is no shared app that works without setup.
  Follow [the app guide](zoom-app.md).
- **The MCP server can change things.** `zm` serves its commands to an MCP client through three tools: one to find a
  command, one to read, and one to write. Writes include creating, changing and cancelling Zoom meetings. The profile's
  permission keys in the configuration decide what an agent may run. A profile can deny a command or allow only
  commands that change nothing. Changes to Zoom meetings ask first at a terminal. Over MCP no one is there to answer,
  so a profile that must not change Zoom sets `{"remote-meetings": "readonly"}`. See [MCP and skills](mcp.md).

## Features

| Feature | zm | [Zoom](https://zoom.us/pricing/aic) | [Otter.ai](https://otter.ai/pricing) | [Fireflies](https://fireflies.ai/pricing) | [Granola](https://www.granola.ai/pricing) | [Fathom](https://www.fathom.ai/pricing) | [tl;dv](https://tldv.io/pricing/) | [Vexa](https://github.com/Vexa-ai/vexa) |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Sign in without first setting up an app | ❌ | ✅ | [✅](https://otter.ai/blog/otter-for-enterprise-connect-ai-to-ai-with-otters-mcp) | [✅](https://docs.fireflies.ai/getting-started/mcp-configuration) | [✅](https://granola.ai/integrations/claude) | [✅](https://developers.fathom.ai/) | ➖ | [🟡](https://github.com/Vexa-ai/vexa) |
| No bot in the call | ✅ | ✅ | ➖ | ➖ | [✅](https://www.granola.ai/pricing) | ➖ | [🟡](https://github.com/tldv-public/tldv-mcp-server) | [❌](https://github.com/Vexa-ai/vexa) |
| Meetings someone else hosted | 🟡 | [🟡](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0064927) | ➖ | ➖ | [✅](https://www.granola.ai/pricing) | ➖ | [✅](https://github.com/tldv-public/tldv-mcp-server) | [✅](https://github.com/Vexa-ai/vexa) |
| Live transcript during the call | ❌ | [🟡](https://www.zoom.com/en/products/ai-assistant/) | ➖ | ➖ | ➖ | ➖ | ➖ | [✅](https://github.com/Vexa-ai/vexa) |
| Transcribe audio on your computer | 🟡 | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | [✅](https://github.com/Vexa-ai/vexa) |
| Import transcript files you already have | ✅ | ➖ | [🟡](https://otter.ai/pricing) | ➖ | ➖ | ➖ | ➖ | ➖ |
| Search by words | ✅ | [✅](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md) | ➖ | [✅](https://docs.fireflies.ai/mcp-tools/overview) | ➖ | [✅](https://www.fathom.ai/pricing) | ➖ | ➖ |
| Search by meaning | ✅ | [✅](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md) | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| English, Russian and Spanish word forms | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| A reference to the exact line, kept after a transcript is corrected | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Saved searches | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Talk time by speaker | ✅ | ➖ | ➖ | [✅](https://docs.fireflies.ai/mcp-tools/overview) | ➖ | [🟡](https://www.fathom.ai/pricing) | ➖ | ➖ |
| Create, change or cancel a Zoom meeting from an agent | ✅ | [🟡](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md) | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Follow-up actions (CRM, email, tasks) | 🟡 | [✅](https://zoom.us/pricing/aic) | [✅](https://otter.ai/pricing) | ➖ | ➖ | [✅](https://www.fathom.ai/pricing) | ➖ | ➖ |
| Bulk download of cloud recordings, with checksums | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| A daily archive job | 🟡 | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| MCP server | ✅ | [✅](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md) | [✅](https://otter.ai/blog/otter-for-enterprise-connect-ai-to-ai-with-otters-mcp) | [✅](https://docs.fireflies.ai/getting-started/mcp-configuration) | [✅](https://granola.ai/integrations/claude) | [✅](https://developers.fathom.ai/mcp-docs/index.md) | [✅](https://github.com/tldv-public/tldv-mcp-server) | [✅](https://github.com/Vexa-ai/vexa) |
| MCP can change things | ✅ | [🟡](https://github.com/zoom/skills/blob/main/skills/zoom-mcp/references/tools.md) | ➖ | [🟡](https://docs.fireflies.ai/mcp-tools/overview) | ➖ | ➖ | [❌](https://github.com/tldv-public/tldv-mcp-server) | ➖ |
| Skill for agents with a terminal | ✅ | [✅](https://github.com/zoom/skills) | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Meetings searched with messages, mail and notes | 🟡 | ➖ | [🟡](https://otter.ai/blog/otter-for-enterprise-connect-ai-to-ai-with-otters-mcp) | ➖ | ➖ | ➖ | ➖ | ➖ |
| Meetings kept on your own disk | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | [✅](https://github.com/Vexa-ai/vexa) |
| Stored meetings work offline | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Login kept only in the system keyring | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Limits for an agent, set per profile | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Several accounts | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Meet and Teams as well as Zoom | ❌ | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | [✅](https://github.com/Vexa-ai/vexa) |

Notes on the `zm` column:

- **Meetings someone else hosted.** `zm` reads meetings that your account hosts or scheduled. For a meeting you only
  attended, get the transcript file from the host and run `meetings import`.
- **Transcribe audio on your computer.** It needs a speech model that you download, and `ffmpeg` for most formats.
  Local transcripts have no speaker names.
- **Search by meaning.** It needs an embedding model that you choose. Without one, search matches words.
- **Follow-up actions.** `meetings task-proposal` shows a task that you could create. It creates nothing.
- **A daily archive job.** It installs on Linux only. Other systems can preview it.
- **Meetings searched with messages, mail and notes.** It works through the other WireCat tools, when you have them.
- **MCP can change things.** See the two facts above.
- **Speaker names and summaries.** `zm` reads the speaker names and the AI summary that Zoom made. It makes no summary
  of its own.

## Install and licence

| | zm | [Zoom](https://zoom.us/pricing/aic) | [Otter.ai](https://otter.ai/pricing) | [Fireflies](https://fireflies.ai/pricing) | [Granola](https://www.granola.ai/pricing) | [Fathom](https://www.fathom.ai/pricing) | [tl;dv](https://tldv.io/pricing/) | [Vexa](https://github.com/Vexa-ai/vexa) |
|---|---|---|---|---|---|---|---|---|
| Install | npm, with Node 22.16 or later | built in | hosted service | hosted service | hosted service | hosted service | hosted service | self host, or hosted bots |
| Licence | Apache-2.0 | closed | closed | closed | closed | closed | closed | Apache-2.0 |

`zm` needs a Zoom account where the meetings you want have transcripts. It reads the transcripts that Zoom made. It
does not create them.

## When another tool fits better

- **Zoom**: you want summaries and questions inside the meeting, with nothing to install.
- **A meeting bot or Vexa**: you need notes of calls that you attend but do not host, or live text during the call.
- **Granola or the tl;dv desktop app**: you want to record calls that you attend, without a bot in them.
- **Vexa**: you want to host everything yourself, or you also use Google Meet and Microsoft Teams.
- **Fireflies, Fathom or Otter.ai**: you want notes and follow-up actions made for you, and a one click sign in.

If `zm` fits, start with [installation](installation.md). To connect an agent, see [MCP and skills](mcp.md).
