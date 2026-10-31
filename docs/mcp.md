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

`zm personal mcp serve` serves zm's commands over MCP's stdio protocol as three tools, the same three every WireCat CLI
serves:

| Tool | What it does |
|---|---|
| `zm_tools_search` | finds the command for a task — "meetings list", "search", "prepare" — with its arguments |
| `zm_read` | runs a command that changes nothing: `{ "command": "meetings list", "arguments": {} }` |
| `zm_write` | runs a command that changes something, such as `remote-meetings create` |

A call runs the command line itself, so it answers and fails exactly as `zm personal <command> --json` does. The
server speaks for the profile named in its `args`; a caller cannot change it. `watch` and the server itself are not
offered. Shared inventory (`meetings scheduled`), project scanning and upgrade are available under the profile permissions.
Interactive login (`session start`) stays in the terminal.
Settings, skill installation, upgrade and archive timer changes require `mcp.authority` at `allow` or `ask`;
profile permissions can only be changed in a terminal.
Grant authority with `zm personal config set permissions '{"mcp.authority":"allow"}'` and reconnect
the app if needed. This replaces the profile's permission map, so include any existing restrictions.

Denied commands remain in full listings and searches with `availability.available: false`, a reason and
the permission key. `readonly` marks writes unavailable. Named-profile CLI help and discovery show the
same current permission information. Calls recheck permissions before running. A command at level `ask` runs without a question, since no one is at a terminal: the built-in `ask` on
`remote-meetings` lets an agent create, change and cancel Zoom meetings. To keep an agent from doing that, give the
profile it serves `{"remote-meetings": "readonly"}`.

In the `mcpServers` format of
[Claude Desktop's configuration](https://modelcontextprotocol.io/docs/develop/connect-local-servers):

```json
{
  "mcpServers": {
    "zoom": { "command": "zm", "args": ["personal", "mcp", "serve"] }
  }
}
```

A desktop app may not see your terminal's `PATH`, and a stdio server inherits only part of the
environment ([MCP debugging guide](https://modelcontextprotocol.io/docs/tools/debugging)). If the
server does not start, use the full path from `command -v zm` on Linux/macOS or `where.exe zm` on Windows as the
command. If you set `ZM_CONFIG_DIR` or `MESSAGING_STORE`, pass the same values in the entry's `env`, or the server
reads a different profile or database. Keep stdout for protocol messages; omit `--json` and `--jsonl`.

### Make one server stricter

`zm personal mcp serve --permission meetings=deny` makes a permission stricter for that server only, and repeats for more
keys. It never loosens the profile: a value that would is refused when the server starts, and so is a key that names no
command. `zm personal mcp config` and `zm personal mcp add` take the same flag, and `mcp add` and `mcp check` set up
and test the entry for Codex or Claude Code.

### Browser apps over HTTP

`zm personal mcp serve --http --public-url https://<name>.ts.net` serves on `127.0.0.1` for AI apps in a browser,
behind your own tunnel; `--port` changes the local port (default 8765). Writes follow the profile's permissions, as
over stdio. A browser app logs in once with a code that the server prints on stderr (`mcp server status` shows it
again); its access lasts one hour and its refresh 30 days. `zm personal mcp revoke` ends every login. `zm personal mcp server start`, `stop` and `status` run
that server in the background, and `--profiles` works with all of these.

### Several profiles from one server

`zm mcp serve --profiles work,personal` serves the profiles it names from one server, and `zm mcp serve --profiles
all` serves every profile here, so an AI app needs one Zoom entry, not one per profile. Each tool then takes a
required `profile`, and the agent is told to ask when you named none. A call runs in that profile's own
`zm <profile> mcp serve`, with that profile's permissions. The server names the profiles it serves on stderr when it
starts.

A server always names what it serves: `zm mcp serve` with no profile and no `--profiles` stops and lists the
profiles here, and so do a profile together with `--profiles` and a name that is not a profile here. Under
`ZM_PROFILE_LOCK`, `--profiles` may name only the locked profile.

```json
{
  "mcpServers": {
    "zoom": { "command": "zm", "args": ["mcp", "serve", "--profiles", "all"] }
  }
}
```

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
