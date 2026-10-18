# Security

Choose what meeting data your agent can read and where processing takes place. Zoom authorization,
local storage and AI processing have separate boundaries: granting app access does not itself send
a transcript to an AI service. This guide explains those boundaries before you connect or archive data.

## Credentials

- `zm` uses a configured Zoom app with Public Client OAuth. Zoom can show a client secret for
  that app, but this tool never asks for or uses it. Configure only its Public Client ID.
- Login uses PKCE and checks the returned state. The callback page at
  [wirecat.dev/zoom-callback](https://wirecat.dev/zoom-callback) is static and only passes the answer
  on to `zm`; the answer is useless without the verifier that stays on your machine.
- Tokens are stored only in the system keyring and are never written to a config file. A missing
  keyring is an error.
- The login listener closes on success, failure and timeout.

## What reaches the network

- Zoom's API, for login, pull, recordings and remote meeting commands. `--offline` refuses network
  requests.
- A remote embedding endpoint only when you name it with `--base-url` ([topic search](topic-search.md)).
- Metadata, help, configuration and `recordings archive` commands work without login.

## What stays on disk

- Meetings live in the shared local WireCat database (`wirecat.db`) unless `MESSAGING_STORE` points
  elsewhere.
- Recording manifests hold metadata, file sizes and SHA-256 checksums. Signed download URLs and OAuth
  tokens are excluded.
- Saved archive jobs capture the profile, public client ID, destination and paths, without credentials.
- Diagnostic messages exclude raw provider error text.

## What agents can do

- The MCP server is read-only and exposes no file exports, remote mutations, embedding generation
  or task creation. Meeting reads use the selected Zoom profile.
- Optional preparation can also read the message accounts, mail accounts and document folders you
  [explicitly select for that profile](configuration.md#select-communications-for-preparation).
  A grant covers the whole account or folder; only requested source IDs are resolved and searched.
  Restart the MCP server after changing or revoking selections. Preparation opens an existing
  compatible store read-only, without migration or index maintenance.
- Local audio transcription uses an already installed model on your machine and downloads none.
- Remote meeting changes, meeting links, transcription, archive job creation,
  explicit `meetings embeddings` generation and lock recovery preview by default and need `--yes`; `--dry-run` wins where
  offered. Remote writes are never automatically retried.
- Word search updates its index automatically. Search with `--model` generates missing vectors before
  ranking; a remote `--base-url` receives transcript passages as well as the query.
- Task proposals never create a task.
- `ZM_READ_ONLY=1` makes a run change nothing. Every command that writes to Zoom, the meeting store or a
  local file — sync, import, export, downloads, archive jobs, links, transcription, configuration,
  login and remote meeting changes — is refused with exit 5 before it connects to anything, previews
  included. Reads, word search (which keeps its index current), `batch` and `serve --mcp` still run.
  Set it for an agent that should only read; `0` or an empty value turns it off.

An AI app can send the tool results it reads to its own provider. Choose that app and its data policy
separately from Zoom authorization. A remote embedding endpoint receives text for generation and
queries only when explicitly selected; local model execution stays on your computer. Stored files
and database content remain sensitive meeting data even though their manifests omit tokens.

To withdraw Zoom access, [revoke the app authorization](sessions.md#remove-access). To control what
an AI app can request, choose the [CLI skill or read-only MCP connection](mcp.md).
