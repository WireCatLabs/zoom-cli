# @wirecat/zoom-cli

`zm` logs in to Zoom with your own public OAuth app and reads hosted meetings, participants,
transcripts and AI summaries. Downloaded WebVTT files can also be imported, including transcripts
from meetings you attended. The shared meeting model, ingestion and commands come from
`@wirecat/cli-meetings`.

## Current availability

Login and sources are implemented and tested. Import, pull and meeting reads are tested with an
in-memory store. The shared SQLite meeting adapter is not available yet, so the executable refuses
those commands until that adapter is connected. It never saves real imports to a temporary memory
store. This package depends on cli-meetings 0.2.0, which must be released before a normal install.

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
| `import <folder>` | import downloaded transcripts once the shared store is available |
| `pull [--since <date>]` | fetch occurrences from the configured source |
| `meetings list`, `meetings show <meeting>` | read stored meetings |
| `meetings transcript <meeting>` | read current transcripts |
| `meetings search <query>`, `meetings people <query>` | find stored text or participants |
| `events list` | read stored events |

Use `--json` for one JSON value or `--jsonl` for one item per line. Errors go to stderr. `--no-input`
refuses browser login. `--help` and `--version` work without a configured app or login.

Config keys: `zoom.clientId`, `source` (`api` or `files`), `files.folder`, and `files.timezone`.
Directories follow the platform convention; `ZM_CONFIG_DIR` overrides the configuration directory.
Changing that directory also changes the keyring service used for login.

## Downloaded transcripts

The files source reads ordinary `.vtt` files directly inside a folder. Names follow the existing
exporter's `YYYY-MM-DD_HHMM_topic-slug.vtt` format. Occurrence ids derive from the timestamp and
normalized topic; files carry no Zoom occurrence UUID. Participants remain unknown, and speaker
names are kept without guessing an identity.

File times default to UTC. Set `files.timezone` to the IANA zone used when the filenames were
created, for example `Europe/Madrid`. Ambiguous or nonexistent daylight-saving times are refused.

## Development

Node 22.12 or newer. After cli-meetings 0.2.0 is released:

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check
pnpm build && pnpm smoke:bun
```

[Architecture](docs/dev/ARCHITECTURE.md), [testing](docs/dev/TESTING.md) and
[prerelease development](docs/dev/DEVELOPMENT.md) describe the local setup. Fixtures use invented
people and meetings. Tests use an injected keyring, scripted HTTP responses, temporary config
folders and the memory meeting store.

## Licence

MIT.
