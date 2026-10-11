# Configuration

Every setting `zm` reads, and the environment variables that change where it keeps things.

## Settings

Set a value with `zm config set <key> <value>` and see them all with `zm config show`.

| Key | Meaning |
|---|---|
| `zoom.clientId` | the Public Client ID of [your Zoom app](zoom-app.md) |
| `account.profile` | the [local profile](sessions.md#select-a-local-profile) label that groups stored meetings |
| `source` | where `pull` and `watch` read from: `api` or `files` |
| `files.folder` | the transcript folder for the files source and file watching |
| `files.timezone` | the IANA zone of downloaded transcript filenames, for example `Europe/Madrid`; default UTC |

A malformed config still allows `--help` and `--version`; config commands report the error.

## Environment variables

| Variable | Effect |
|---|---|
| `ZM_CONFIG_DIR` | overrides the configuration directory; changing it also changes the keyring service used for login |
| `MESSAGING_STORE` | selects an explicit shared database path for import, pull, watch, meeting reads and MCP reads |
| `OPENAI_API_KEY` | used by an explicitly selected OpenAI embedding endpoint ([topic search](topic-search.md)) |

Directories otherwise follow the platform convention. The default shared database is `wirecat.db`
([where meetings are stored](archive.md#where-meetings-are-stored)).
