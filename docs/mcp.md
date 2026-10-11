# MCP and skills

Give an agent your stored Zoom meetings: as a skill for agents that run commands in a terminal, or as
a read-only MCP server for clients that cannot.

## The agent skill

`zm skill show` prints the packaged instructions for an agent. `zm skill install` writes a
version-stamped copy to the agent skills directories: `~/.claude/skills/zoom-cli/` for Claude Code and
`~/.agents/skills/zoom-cli/` for Codex and Gemini CLI. `--for claude` or `--for agents` selects one;
the default is both. Installation is explicit and does not run when a command starts.

## The MCP server

`zm serve --mcp` uses MCP's stdio protocol and serves seven read-only tools: meeting list/show,
transcripts, summaries, exports, text search and participant search. Tool discovery does not open a
database. Each read uses the selected local account and closes its connection before the response;
a caller cannot override the account. File exports and remote mutations are not exposed as tools.

MCP clients can launch `zm` with arguments `["serve", "--mcp"]`. In the `mcpServers` format of
[Claude Desktop's configuration](https://modelcontextprotocol.io/docs/develop/connect-local-servers):

```json
{
  "mcpServers": {
    "zoom": { "command": "zm", "args": ["serve", "--mcp"] }
  }
}
```

A desktop app may not see your terminal's `PATH`, and a stdio server inherits only part of the
environment ([MCP debugging guide](https://modelcontextprotocol.io/docs/tools/debugging)). If the
server does not start, use the full path from `which zm` as the command. If you set `ZM_CONFIG_DIR` or `MESSAGING_STORE`, pass the same values
in the entry's `env`, or the server reads a different profile or database.

Keep stdout for protocol messages; omit `--json`, `--jsonl` and `--fields`. `--max-output-bytes`
bounds each tool result, with zero meaning unlimited. Select a profile and import or pull its data
before reading tools; discovery is available without stored data.

## Optional tools

Optional flags add tools without changing the defaults: `--meeting-context` adds evidence, person
context and task proposals; `--unified-search` adds meetings-only shared search;
`--semantic --model <id>` adds one read-only vector query tool. Remote semantic models additionally
require `--base-url` and `--dims`. The server fixes the model at startup and the profile on its first
read; restart it to change either. Clients cannot override either selection. Embedding generation
and task creation are never MCP tools.
