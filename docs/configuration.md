# Configuration

Change which app, source or local profile the tool uses, and check the settings before a pull or
agent session. Public configuration selects the app and data paths; OAuth tokens remain in the
system keyring. This reference gives the accepted keys and their defaults.

## Settings

Set a value with `zm config set <key> <value>`, remove it with `zm config unset <key>`, and see them all with
`zm config show`.

| Key | Meaning |
|---|---|
| `zoom.client_id` | Public Client ID of the [existing or new app](zoom-app.md); unset by default, required for API login |
| `source` | Where `meetings sync` and `watch` read from: `api` (default) or `files` |
| `files.folder` | Transcript folder for file-source pull/watch; unset by default |
| `context.sources` | JSON array of explicitly selected message, mail or document accounts for this profile; empty by default ([setup below](#select-communications-for-preparation)) |
| `files.timezone` | the IANA zone of downloaded transcript filenames, for example `Europe/Madrid`; unset: this computer's zone |
| `record` | `false` keeps only failed runs in the [run log](#run-log); unset or `true`: every run |
| `keep_runs_for_days` | how many days a failed run stays before it is removed; 30 by default |
| `keep_successful_runs_for_days` | how many days a successful run stays; 7 by default |
| `runs_size_limit_mb` | the most the run log may hold; the oldest successful runs go first; 200 by default |

Check `zm config show` after editing. The profile is not a setting: it is the first word of each
command ([profiles](sessions.md#select-a-local-profile)). Changing the client ID selects a different keyring entry, so authorize that app before
using its API. `ZOOM_CLIENT_ID` is not a runtime setting for the installed `zm` command; use
`zm config set zoom.client_id` rather than an environment variable copied from a development probe.

The file stores these settings as `client_id`, `files_folder`, `files_timezone`, `source`, `context_sources`,
`record`, `keep_runs_for_days`, `keep_successful_runs_for_days` and `runs_size_limit_mb`, and the profiles on this computer under `profiles`. Any other key is a problem in
the file.

## Problems in the file

A file with problems still allows `--help`, `--version`, `zm config` and `zm doctor`. Every other command stops on
the first problem, names how to remove it, and says how many more there are. `zm doctor --json` lists them all
under `config.issues`:

```json
{ "kind": "unknown_setting", "file": "/home/you/.config/zm/config.json", "key": "example_setting",
  "what": "setting example_setting is not a setting of zm", "fix": "zm config unset example_setting" }
```

`kind` is `invalid_json`, `unknown_setting`, `unknown_permission` or `invalid_value`. `what` says what a value has
to be and never shows the saved value. `fix` runs exactly as written; it is left out for invalid JSON, where `line`
and `column` say where reading stopped. A problem in one profile's permissions also gives that `profile`. A
broken part of a setting, such as one entry of `context_sources`, is reported as the whole setting, and its fix
removes it. A config path that is a folder or cannot be read is one problem with the whole file, with no fix.
`zm config show` prints each problem after the settings that still load, and `zm config set` and
`zm config unset` change the file without touching the rest of it.

## Find the configuration file

`zm config set` creates and updates `config.json` for you. It contains public settings, not Zoom
access tokens; you do not download this file from Marketplace. `zm doctor --json` reports its
actual path without checking the saved OAuth session.

| Platform | Default public configuration |
|---|---|
| Linux and macOS | `~/.config/zm/config.json`, or the `zm` directory under `XDG_CONFIG_HOME` |
| Windows | `%APPDATA%\zm\Config\config.json` |
| Explicit override | `config.json` inside `ZM_CONFIG_DIR` |

Older macOS layouts are no longer moved automatically; doctor shows the path actually in use. Keep
public app settings separate from keyring tokens and the shared meeting database.

`zm config set` saves the file so only you can read it (`0600`). `zm doctor --json` lists the file and its folder
under `files.problems` when other users can read them, each as `path`, `mode` (found) and `want`, and prints the
`chmod` that fixes each on stderr. It changes nothing itself. Windows is not checked.

## Permissions

Each profile says what it may do in `permissions`: a command path, dotted, to a level.

```sh
zm personal config set permissions '{"remote-meetings": "allow", "recordings": "readonly"}'
```

| Level | Effect |
|---|---|
| `deny` | the command is refused |
| `readonly` | it runs only when it changes nothing, as under `ZM_READ_ONLY` |
| `ask` | a change to Zoom asks y/N at a terminal; without one it needs `--yes` (exit 7 otherwise) |
| `allow` | it runs; a change to Zoom applies without `--yes` |

The most specific key wins (`remote-meetings.cancel` over `remote-meetings`). Built in, `remote-meetings` is `ask`;
a broader key the owner sets never loosens it, a key as deep does. `--yes` only answers `ask`: it never lifts
`deny` or `readonly`. In a terminal, settings, login, help and the MCP server are never gated. A key that names no command, or
a level that is not one of the four, is refused when set; one already saved stops every command until
`zm <profile> config unset permissions.<key>` removes it. `ZM_READ_ONLY` applies on top of every level.

Settings, skill installation, upgrade and archive timer changes over MCP require `mcp.authority` at `allow` or `ask`.
It is denied by default. Set it from a terminal through the profile's `permissions` map,
preserving any existing restrictions, then restart the MCP server. An MCP agent cannot change
profile permissions. See [MCP and skills](mcp.md#the-mcp-server).

## Run log

`zm` keeps every command as a run: the command's words, the profile, how it ended, and one event per Zoom request
with its method, path (every id masked as `:id`), status, duration, attempt (2 and up for a retry) and the wait before
a retry. It never keeps meeting content, names, emails or tokens. A successful run is kept 7 days and a failed one 30.
`record false` keeps only failed runs, `--record` keeps this run anyway, and `--no-record` keeps nothing for this
command. `zm runs list`, `zm runs show <run-id>` and `zm runs path <run-id>` read the
log without a profile; an answer's `meta.run_id` is the id `runs show` takes.

## Environment variables

| Variable | Effect |
|---|---|
| `ZM_CONFIG_DIR` | overrides the configuration directory; changing it also changes the keyring service used for login |
| `ZM_STATE_DIR` | overrides the directory for recorded runs (`runs/`) |
| `ZM_CACHE_DIR` | overrides the cache directory |
| `ZM_READ_ONLY` | `1` refuses changes to Zoom, the login, settings and what you added, with exit 5; reads and syncs from Zoom still run ([security](security.md#what-agents-can-do)) |
| `WIRECAT_STATE_DIR` | moves the WireCat folder every WireCat CLI shares: the database and the speech models |
| `MESSAGING_STORE` | selects an explicit shared database path for import, pull, watch, meeting reads and MCP reads |
| `OPENAI_API_KEY` | used by an explicitly selected OpenAI embedding endpoint ([topic search](topic-search.md)) |

Directories otherwise follow the platform convention. The default shared database is `wirecat.db`
(`~/.local/share/WireCat/wirecat.db`, `%LOCALAPPDATA%\WireCat\Data\wirecat.db` on Windows)
([where meetings are stored](archive.md#where-meetings-are-stored)). Use the same environment in your
terminal and MCP entry; otherwise they can read different profiles or stores. Continue with
[sessions](sessions.md) to verify authorization separately from these public settings.

## Select communications for preparation

Preparation can search accounts already imported into the shared database. Select the local Zoom
profile first, then save up to eight source selections for it. Each entry needs an ID, kind,
provider and account. Message and mail identities must match their stored provider/account exactly;
copy those identities from the producing tool's account settings or canonical references. Do not
use a display name in place of an account identity.

```sh
zm research config set context.sources '[{"id":"project-notes","kind":"document","provider":"local","account":"notes:5"}]'
zm config show
```

This example uses an invented folder ID. Run `memo folders list` and substitute the ID of the
folder you choose, and its provider: `local` for a plain folder, `obsidian` for a vault. A source
saved earlier with provider `folder` still resolves. `notes:5` resolves that existing folder's stored identity; it does not create
or import a folder. A document source selects one folder, a message source one messaging account,
and a mail source one mail account. These grants cover the selected account or folder; there is
currently no chat, sender or path restriction within it. Do not grant a whole account if that scope
is broader than you intend.

The setting replaces the selections for the current profile, preserving other profiles. Use `[]`
to revoke this profile's selections. Duplicate IDs and identities, unknown fields and more than
eight entries are refused. The JSON file stores the flat array as `context_sources`, adding the
selected `profile` to each entry. Continue using `config set` to avoid hand-editing that layout.

Only an explicit preparation request resolves and searches its requested sources. An unavailable
configured source that you did not request does not block other selections. Normal meeting reads do not acquire
cross-account access. An MCP server captures source definitions at startup and pins each requested source's stored
identity on first use; restart it after changing or revoking selections. Missing or mismatched
identities fail closed. No source is selected automatically.
