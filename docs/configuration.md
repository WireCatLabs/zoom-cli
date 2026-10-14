# Configuration

Change which app, source or local profile the tool uses, and check the settings before a pull or
agent session. Public configuration selects the app and data paths; OAuth tokens remain in the
system keyring. This reference gives the accepted keys and their defaults.

## Settings

Set a value with `zm config set <key> <value>` and see them all with `zm config show`.

| Key | Meaning |
|---|---|
| `zoom.client_id` | Public Client ID of the [existing or new app](zoom-app.md); unset by default, required for API login |
| `account.profile` | [Local label](sessions.md#select-a-local-profile) for stored meetings; unset by default, required for store operations |
| `source` | Where `meetings sync` and `watch` read from: `api` (default) or `files` |
| `files.folder` | Transcript folder for file-source pull/watch; unset by default |
| `files.timezone` | the IANA zone of downloaded transcript filenames, for example `Europe/Madrid`; default UTC |

Check `zm config show` after editing. Switching `account.profile` does not switch the authenticated
Zoom user. Changing the client ID selects a different keyring entry, so authorize that app before
using its API. `ZOOM_CLIENT_ID` is not a runtime setting for the installed `zm` command; use
`zm config set zoom.client_id` rather than an environment variable copied from a development probe.

The file stores these settings as `client_id`, `files_folder`, `files_timezone`, `account_profile` and `source`.
The camelCase names `zoom.clientId`, `clientId`, `filesFolder`, `filesTimezone` and `accountProfile` are still read.

A malformed config still allows `--help` and `--version`; config commands report the error.

## Find the configuration file

`zm config set` creates and updates `config.json` for you. It contains public settings, not Zoom
access tokens; you do not download this file from Marketplace. `zm doctor --json` reports its
actual path without checking the saved OAuth session.

| Platform | Default public configuration |
|---|---|
| Linux and macOS | `~/.config/zm/config.json`, or the `zm` directory under `XDG_CONFIG_HOME` |
| Windows | `%APPDATA%\zm\Config\config.json` |
| Explicit override | `config.json` inside `ZM_CONFIG_DIR` |

Older macOS layouts are migrated when possible; doctor shows the path actually in use. Keep
public app settings separate from keyring tokens and the shared meeting database.

## Environment variables

| Variable | Effect |
|---|---|
| `ZM_CONFIG_DIR` | overrides the configuration directory; changing it also changes the keyring service used for login |
| `MESSAGING_STORE` | selects an explicit shared database path for import, pull, watch, meeting reads and MCP reads |
| `OPENAI_API_KEY` | used by an explicitly selected OpenAI embedding endpoint ([topic search](topic-search.md)) |

Directories otherwise follow the platform convention. The default shared database is `wirecat.db`
([where meetings are stored](archive.md#where-meetings-are-stored)). Use the same environment in your
terminal and MCP entry; otherwise they can read different profiles or stores. Continue with
[sessions](sessions.md) to verify authorization separately from these public settings.
