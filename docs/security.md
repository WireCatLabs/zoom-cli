# Security

What `zm` keeps on your disk, what it sends over the network, and what it never does.

## Credentials

- `zm` uses your own Zoom app with Public Client OAuth. The app has no client secret.
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

- The MCP server is read-only, fixed to the selected local account, and exposes no file exports,
  remote mutations, embedding generation or task creation.
- Remote meeting changes, archive job creation, embedding generation and lock recovery preview by
  default and need `--yes`; `--dry-run` wins where offered. Remote writes are never automatically retried.
- Task proposals never create a task.
