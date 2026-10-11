# zm — Zoom for your AI agent

`zm` keeps your Zoom meetings, transcripts and AI summaries in a local database and gives them to
your AI agent: before a call, what you discussed with these people last time; after it, what was
said and promised, with a reference to the exact passage.

It logs in with your own Zoom app, reads meetings you hosted through Zoom's official API, imports
transcript files for meetings you only attended, and archives cloud recordings with verified
checksums. Agents use it as a command line tool with a packaged skill, or as a read-only MCP server.

## One minute to the first result

```sh
npm install -g @wirecat/zoom-cli
zm config set zoom.clientId <public-client-id>    # from your own Zoom app
zm login
zm config set account.profile personal
zm pull --lookback-days 7
zm meetings list
```

Creating the Zoom app takes a few minutes the first time: [the app guide](zoom-app.md).

## Where to go next

- [Installation](installation.md) — requirements, first run, where files go.
- [Login, sessions and profiles](sessions.md) — the OAuth login, the keyring, local profiles.
- [The local archive](archive.md) — pull, import, watch and cloud recording backups.
- [Search and evidence](search.md) — find what was said and read it with its source.
- [MCP and skills](mcp.md) — connect Claude Code, Codex, Gemini CLI or an MCP client.
- [Every command](commands.md) · [configuration](configuration.md) ·
  [troubleshooting](troubleshooting.md) · [security](security.md).
