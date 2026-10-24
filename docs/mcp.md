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
| An MCP-capable local AI app | Add the server entry below and restart the app | The same commands, as three tools |

Both reach the same commands under the same [permissions](configuration.md#permissions) of the profile.

## The agent skill

`zm skill show` prints the packaged instructions for an agent. `zm skill install` writes a
version-stamped copy to the agent skills directories: `~/.claude/skills/zoom-cli/` for Claude Code and
`~/.agents/skills/zoom-cli/` for Codex and Gemini CLI. `--for claude` or `--for agents` selects one;
the default is both. Installation is explicit and does not run when a command starts.

## The MCP server

`zm personal mcp` serves zm's commands over MCP's stdio protocol as three tools, the same three every WireCat CLI
serves:

| Tool | What it does |
|---|---|
| `zm_tools_search` | finds the command for a task — "meetings list", "search", "prepare" — with its arguments |
| `zm_read` | runs a command that changes nothing: `{ "command": "meetings list", "arguments": {} }` |
| `zm_write` | runs a command that changes something, such as `remote-meetings create`, or `search meetings`, which updates the word index first |

A call runs the command line itself, so it answers and fails exactly as `zm personal <command> --json` does. The
server speaks for the profile named in its `args`; a caller cannot change it. `watch`, `complete` and the server itself are not offered. Shared inventory (`meetings scheduled`), project scanning and upgrade are available under the profile permissions.
Interactive login (`session start`) stays in the terminal.
Settings, skill installation, upgrade and archive timer changes require `mcp.authority` at `allow` or `ask`;
profile permissions can only be changed in a terminal.
Grant authority with `zm personal config set permissions '{"mcp.authority":"allow"}'` and restart
the server. This replaces the profile's permission map, so include any existing restrictions.

What the profile's permissions deny is neither offered nor run, and `readonly` withholds the commands that change
something. A command at level `ask` runs without a question, since no one is at a terminal: the built-in `ask` on
`remote-meetings` lets an agent create, change and cancel Zoom meetings. To keep an agent from doing that, give the
profile it serves `{"remote-meetings": "readonly"}`.

In the `mcpServers` format of
[Claude Desktop's configuration](https://modelcontextprotocol.io/docs/develop/connect-local-servers):

```json
{
  "mcpServers": {
    "zoom": { "command": "zm", "args": ["personal", "mcp"] }
  }
}
```

A desktop app may not see your terminal's `PATH`, and a stdio server inherits only part of the
environment ([MCP debugging guide](https://modelcontextprotocol.io/docs/tools/debugging)). If the
server does not start, use the full path from `command -v zm` on Linux/macOS or `where.exe zm` on Windows as the
command. If you set `ZM_CONFIG_DIR` or `MESSAGING_STORE`, pass the same values in the entry's `env`, or the server
reads a different profile or database. Keep stdout for protocol messages; omit `--json` and `--jsonl`.

### Upgrading from 0.34 and earlier

`zm serve --mcp` and its flags (`--meeting-context`, `--meeting-preparation`, `--semantic` and the others) are gone;
`zm serve` now says so. Use `meetings context`, `meetings prepare`, `search all` and `search meetings --model` through the
shared server. Change
the entry's `args` to `["personal", "mcp"]`.

## Try the connection

After installing the skill, start a new agent session if it has not discovered the instructions.
After adding MCP, restart the AI app and confirm that its Zoom tools are available. Ask:

```text prompt
List my stored meetings. Open the latest one and show its date, available transcript and one
passage supporting its main decision. Tell me if the data is incomplete.
```

Check the selected meeting against `zm personal meetings list --json` in your terminal. If discovery works
but no data appears, verify the same profile and store path, then pull or import data. A remote web chat cannot
run this local command unless it has a supported connection to your machine.

## Selected communications in meeting preparation

`meetings prepare` reads the message, mail and document sources configured for the profile
([source selections](configuration.md#select-communications-for-preparation)); over MCP it is the same command,
so the same sources apply and a source not configured is refused. See
[limits and continuation](usage.md#include-selected-messages-mail-and-documents).
