# @wirecat/zoom-cli

`zm` logs in to Zoom with your own public OAuth app and reads hosted meetings, participants,
transcripts and AI summaries. Downloaded WebVTT files can also be imported, including transcripts
from meetings you attended. The shared meeting model, ingestion and commands come from
`@wirecat/cli-meetings`.

## Current availability

Login and sources are implemented and tested. This development branch connects import, pull and
meeting reads to cli-messaging's shared SQLite store. It requires a compatible cli-messaging release
with the meeting adapter and stored account lookup; the published Zoom 0.1.1 executable still
refuses persistence commands. The shared model and contract kit use cli-meetings 0.2.3.

## Set up your Zoom app

Follow [the app guide](docs/zoom-app.md). Use Public Client OAuth and redirect to
`https://wirecat.dev/zoom-callback`. Configure the Public Client ID, then log in:

```sh
zm config set zoom.clientId <public-client-id>
zm login --browser firefox
```

The callback returns to a listener on your machine. If it cannot, paste the `code=…&state=…`
parameters shown on the callback page. Login checks the state and PKCE verifier, stores tokens
only in the system keyring, and returns login status and actual granted scopes. A missing keyring
is an error; tokens are never written to a config file.

## Commands

| Command | Purpose |
|---|---|
| `config show` | show local configuration |
| `config set <key> <value>` | configure the public client or file source |
| `login [--browser <program>]` | approve access through your browser |
| `import <folder>` | import downloaded transcripts into the selected profile |
| `pull [--since <date>]` | fetch occurrences from the configured source |
| `meetings list`, `meetings show <meeting>` | read stored meetings |
| `meetings transcript <meeting>` | read current transcripts |
| `meetings search <query>`, `meetings people <query>` | find stored text or participants |
| `events list` | read stored events |

Use `--json` for one JSON value or `--jsonl` for one item per line. Errors go to stderr. `--no-input`
refuses browser login. `--help` and `--version` work without a configured app or login.

Config keys: `zoom.clientId`, `account.profile`, `source` (`api` or `files`), `files.folder`,
and `files.timezone`.
Directories follow the platform convention; `ZM_CONFIG_DIR` overrides the configuration directory.
Changing that directory also changes the keyring service used for login.

## Select a local profile

Choose a label for the stored meetings:

```sh
zm config set account.profile personal
```

Labels contain 1–64 letters, digits, dots, underscores or hyphens and start with a letter or digit.
The label groups local meeting data; OAuth login uses the configured client and keyring entry. Use
separate labels for data you want kept in separate accounts. File import and API pull share the
selected profile. Folder import leaves its pull cursor unchanged; switching pull sources may need
an older explicit `--since` to revisit earlier occurrences.

Import or pull registers the selected profile in the shared store. Read commands require an
existing profile and never register an empty account. The default database is the shared
`wirecat.db`; `MESSAGING_STORE` overrides its path. The connection opens only for store commands
and closes after success or failure. The old `messages.db` is left untouched.

## Recover from errors

If the browser cannot start, select an installed browser with `--browser firefox`. In an interactive
terminal, you can also paste the callback parameters. Without paste input, a launch failure exits
promptly. A malformed config still allows `--help` and `--version`; config commands report the error.

Missing-scope errors name the required scope. Add it in your Zoom app, then log in again. A network
failure reports a provider error; malformed provider replies report an invalid response. Diagnostic
messages exclude raw provider error text.

Once persistence is connected, use `pull --lookback-days 7` to revisit the last seven days, or an
older explicit `pull --since 2026-10-01` for earlier occurrences whose transcript appeared later. The cursor alone does not guarantee
that late transcripts are revisited. Serialize pulls for the same account to avoid concurrent event
creation. A failed occurrence leaves the cursor unchanged so the next pull can retry it.

## Downloaded transcripts

The files source reads ordinary `.vtt` files directly inside a folder. Names follow the existing
exporter's `YYYY-MM-DD_HHMM_topic-slug.vtt` format. Occurrence ids derive from the timestamp and
normalized topic; files carry no Zoom occurrence UUID. Participants remain unknown, and speaker
names are kept without guessing an identity.

File times default to UTC. Set `files.timezone` to the IANA zone used when the filenames were
created, for example `Europe/Madrid`. Ambiguous or nonexistent daylight-saving times are refused. Conflicting contents for the same
normalized filename key are an error; correct the conflicting files before retrying. File discovery
fails explicitly on invalid names rather than silently importing a partial folder.

## Development

Node 22.16 or newer within Node 22, or Node 24 or newer:

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check
pnpm build && pnpm smoke:bun
```

[Architecture](docs/dev/ARCHITECTURE.md), [testing](docs/dev/TESTING.md) and
[development setup](docs/dev/DEVELOPMENT.md) describe the local setup.
[Releasing](docs/dev/RELEASING.md) covers package checks and trusted publishing. Fixtures use invented
people and meetings. Tests use an injected keyring, scripted HTTP responses, temporary config
folders and the memory meeting store.

## Licence

[Apache License 2.0](LICENSE).
