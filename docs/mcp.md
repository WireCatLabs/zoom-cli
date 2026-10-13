# MCP and skills

Let an AI agent read your stored meeting text and return source-backed answers. Choose a skill
for a terminal agent or MCP for an AI app that launches local tools. A skill is an instruction file;
MCP is the protocol the app uses to call tools. Neither connection logs in or downloads meetings.
[Import or pull at least one meeting](installation.md#first-run) before trying a transcript question.

## Choose the connection

| Agent you use | Connect it | Result |
|---|---|---|
| Codex or Gemini CLI on this computer | `zm skill install --for agents` | Installs instructions for using CLI commands |
| Claude Code on this computer | `zm skill install --for claude` | Installs its CLI instructions |
| An MCP-capable local AI app | Add the server entry below and restart the app | Exposes stored meeting read tools |

A terminal agent can run the broader CLI, including writes when instructed. The MCP server provides
a narrower read-only tool set. These are different access choices.

## The agent skill

`zm skill show` prints the packaged instructions for an agent. `zm skill install` writes a
version-stamped copy to the agent skills directories: `~/.claude/skills/zoom-cli/` for Claude Code and
`~/.agents/skills/zoom-cli/` for Codex and Gemini CLI. `--for claude` or `--for agents` selects one;
the default is both. Installation is explicit and does not run when a command starts.

## The MCP server

`zm serve --mcp` uses MCP's stdio protocol and serves eight read-only tools: meeting list/show,
transcripts, summaries, exports, text search, participant search and bounded context-filtered search. Tool discovery does not open a
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
server does not start, use the full path from `command -v zm` on Linux/macOS or `where.exe zm` on Windows as the command. If you set `ZM_CONFIG_DIR` or `MESSAGING_STORE`, pass the same values
in the entry's `env`, or the server reads a different profile or database.

Keep stdout for protocol messages; omit `--json`, `--jsonl` and `--fields`. `--max-output-bytes`
bounds each tool result, with zero meaning unlimited. Select a profile and import or pull its data
before reading tools; discovery is available without stored data.

## Try the connection

After installing the skill, start a new agent session if it has not discovered the instructions.
After adding MCP, restart the AI app and confirm that its Zoom tools are available. Ask:

```text prompt
List my stored meetings. Open the latest one and show its date, available transcript and one
passage supporting its main decision. Tell me if the data is incomplete.
```

Check the selected meeting against `zm meetings list --json` in your terminal. If discovery works
but no data appears, verify the same profile and store path, then pull or import data. If the app
cannot launch the command, use `where.exe zm` on Windows or `command -v zm` on Linux/macOS to find it,
and put that executable's full path in the entry. A remote web chat cannot run this local command
unless it has a supported connection to your machine.

## Optional tools

Optional flags add tools without changing the defaults: `--meeting-context` adds evidence, person
context and task proposals; `--unified-search` adds meetings-only shared search;
`--semantic --model <model>` adds one read-only vector query tool. Remote semantic models additionally
require `--base-url` and `--dims`. The server fixes the model at startup and the profile on its first
read; restart it to change either. Clients cannot override either selection. Embedding generation
and task creation are never MCP tools.

For broader meeting context across projects, notes and documents, continue with
[search and evidence](search.md#notes-tags-and-memories-with-memo); connect Memo separately where needed.
