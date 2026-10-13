# Installation

Install the Zoom command-line tool on the computer where your AI agent runs, connect your Zoom
account and retrieve a first meeting. The package is `@wirecat/zoom-cli`; the command you type is
`zm`. You can reuse a Zoom app that is already configured for you, create your own, or import
transcript files without an app or login.

## What it needs

- **Node.js 22.16 or newer within 22.x, or Node.js 24 or newer**, with npm. The tool also runs on Bun.
  Install Node.js from [nodejs.org](https://nodejs.org/en/download) if `node --version` is unavailable.
- Linux, macOS or Windows. Open a terminal on that computer to run the commands below.
- For API login, a working system keyring: your operating system's password store. macOS uses
  Keychain, Windows uses Credential Manager, and Linux needs an available desktop secret store.
  A headless server without a keyring cannot save a login; file import remains available.
- A Zoom account allowed to authorize the app. An organization may require administrator approval.

## Install

```sh
npm install -g @wirecat/zoom-cli
zm --version
zm --help
zm doctor
```

The version and help should print without login. Doctor checks the runtime and public settings;
it does not contact Zoom or open your meeting database. If `zm` is not found, reopen the terminal
and check that npm's global executable directory is on PATH, the list of folders your terminal searches.

## Choose how to connect

| Your starting point | Next action |
|---|---|
| You already created a Zoom app | Open its credentials, enable Public Client OAuth and copy its **Public Client ID**; use the checklist below |
| Your team supplied an app, including a WireCat app | Obtain its **Public Client ID** from the app owner and confirm your Zoom user is allowed to authorize it; then use the same login steps |
| You need an app | Follow [Create your own app](zoom-app.md#create-your-own-app), then return here with its Public Client ID |
| You only have transcript files | Skip browser login and use [Import without a Zoom app](#import-without-a-zoom-app) |

A Zoom app is a permission registration in the Marketplace, separate from your Zoom account and
from the Zoom meeting application. There is no credentials file to download: configure its
Public Client ID, then authorize your account in the browser. `zm` requires an explicit client ID; installing it does not
select an app for you. A development app can be restricted to its developer's account. A client
ID alone does not grant access to somebody else's Zoom data.

Before login, the app owner checks these settings in the same Development or Production environment
as the chosen ID:

| Setting | Required value |
|---|---|
| App type / management | General app / User-managed |
| Use Public Client OAuth | On; copy the **Public Client ID**, not the regular Client ID or Client Secret |
| OAuth Redirect URL | `https://wirecat.dev/zoom-callback` |
| OAuth Allow Lists | Include `https://wirecat.dev/zoom-callback` |
| Scopes | The [meeting-read scopes](zoom-app.md#what-the-manifest-asks-for); archive or management scopes only for those tasks |

## First run

Replace `<public-client-id>` with the ID you copied, without angle brackets. Run the commands one
at a time; keep the login terminal open while approving in the browser:

```sh
zm config set zoom.clientId <public-client-id>
zm config set source api
zm session start
```

1. Sign in to the intended Zoom account in the browser and review the app's permissions.
2. Choose **Allow**. Zoom opens the WireCat callback page, which forwards the authorization to
   the waiting `zm` process on your computer.
3. Return to the terminal. Login is complete when `zm` reports `loggedIn: true` and returns to
   the prompt. Browser approval alone is not completion.
4. If the terminal keeps waiting, copy the callback page's `code=…&state=…` value or full callback
   URL, paste it into that same waiting terminal and press Enter. Do this before the five-minute
   login deadline. If the process already ended, run `zm session start` again and approve the new attempt.

Then check the saved session and choose a **profile**, a local label for the meetings you store:

```sh
zm session status --json
zm config set account.profile personal
zm meetings sync --lookback-days 7
zm meetings list --json
```

The session should report `loggedIn: true`. A successful pull stores the available hosted meetings;
the list returns their local IDs. Open one using the ID from that list:

```sh
zm meetings show <meeting-id> --json
zm meetings transcript <meeting-id> --json
```

An empty list is possible when no hosted meetings are available in that period. An empty transcript
means Zoom did not supply text; app permission does not create a transcript. Check
[transcript retention](zoom-app.md#before-your-first-zm-meetings-sync), then pull an older period if needed.
A missing-scope error names the permission to add; authorize again after the app owner changes it.

A local profile does not switch the Zoom account logged in through the browser. Use
[sessions](sessions.md#select-a-local-profile) when separating accounts, and
[login recovery](troubleshooting.md#login) if approval does not complete.

## Import without a Zoom app

Use a VTT transcript you are allowed to download or a file supplied by the host. Put it in a folder
and name it with its meeting date, time and title, for example
`2026-10-01_1000_example-planning.vtt`. The filename time is interpreted in the configured timezone:

```sh
zm config set account.profile personal
zm config set files.timezone Europe/Madrid
zm meetings import ./downloaded-transcripts
zm meetings list --json
```

No app, browser login or OAuth token is needed. Import accepts ordinary `.vtt` files directly in the
folder; it does not recurse or infer attendees from speaker names. See [downloaded transcripts](archive.md#downloaded-transcripts).

## Give your agent access

After the first meeting is stored, install the packaged instructions for a terminal agent:

```sh
zm skill install --for agents
```

This selects Codex/Gemini's skills directory; use `--for claude` for Claude Code, or omit `--for` to
install both. For an AI app that launches tools through MCP, use [MCP and skills](mcp.md). Try asking:

```text prompt
Find the meeting I just imported or downloaded. Show its date, the main discussion and one supporting passage.
Tell me whether the transcript or participant information is missing.
```

## Where files go

The tool creates its public `config.json` when you set configuration; this is not a downloaded
credentials file. `zm doctor --json` shows its location. Configuration uses your platform's application directory. `ZM_CONFIG_DIR` selects another directory
and also changes the keyring service used for login. Meetings use the shared local `wirecat.db`;
`MESSAGING_STORE` selects another database. Recording downloads go only to the destination you
name. See [configuration](configuration.md) for these settings.

## Update or remove the tool

```sh
npm install -g @wirecat/zoom-cli
zm --version
```

To remove the command:

```sh
npm uninstall -g @wirecat/zoom-cli
```

Uninstalling the package does not erase the shared meeting database or recording folders. Revoke
app access in Zoom's Marketplace if you also want to withdraw its account authorization. There is
no logout command; see [sessions](sessions.md#remove-access) for the available controls.

## Shell completion

`zm complete -- <words...>` answers a shell's completion requests; it does not install completion
into your shell. `zm commands --json` lists supported commands and options for agents and scripts.

Once your first meeting is visible, [search its transcript and keep source references](search.md).
