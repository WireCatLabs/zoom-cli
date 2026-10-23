# Install and connect Zoom

Give your AI agent access to saved Zoom transcripts so it can find what was discussed and show
the passages behind an answer. You can set this up with your agent or run the commands yourself.
If you already have transcript files, you can start without creating a Zoom app or logging in.

## The steps

1. [Install the tool](#install) on the computer where your agent runs.
2. [Choose your source](#choose-how-to-connect): your Zoom account or downloaded transcript files.
3. [Connect your agent](#give-your-agent-access) so it knows how to use the tool.
4. [Check one meeting](#check-your-first-result) and read a supporting passage.

If meetings are already stored, go straight to [search and evidence](search.md).

## Set up with your agent

Use an agent that can run commands on this computer, such as Codex, Claude Code, Cursor or Gemini
CLI. Copy this request into its chat:

```text prompt
Use zm CLI to help me connect Zoom meeting transcripts to my AI agent on this computer.
Follow https://wirecat.dev/en/docs/zm/installation and check the required programs before installing.
Ask whether I want to connect my Zoom account or import transcript files I already have.
If I choose Zoom, help me use my existing app or create one and find its Public Client ID.
Let me approve login in my browser; do not ask me to paste tokens or callback codes into this chat.
Install the tool's instructions for my agent, then find one stored meeting and show a cited passage.
Explain what data is missing. Do not create or change remote meetings.
```

The agent can prepare the tool and check results. You choose the app and account, approve Zoom's
consent screen and handle the login callback if needed. If the agent cannot keep an interactive
login terminal open, run [First run](#first-run) yourself, then return to it.
For an agent without terminal access, follow [MCP and skills](mcp.md).

## What it needs

- **Node.js 22.16 or newer within 22.x, or Node.js 24 or newer**, with npm. Check `node --version`
  and `npm --version` in Terminal on macOS/Linux or PowerShell on Windows. If either is missing,
  install Node.js from [nodejs.org](https://nodejs.org/en/download), reopen the terminal and check again.
  The tool also runs on Bun.
- A folder for the meetings you choose to keep on this computer. A tool installed on a server
  uses that server's files and login, not your laptop's.
- **For Zoom account access:** an account allowed to authorize the app and a working system
  password store: Keychain on macOS, Credential Manager on Windows, or a desktop secret store on Linux.
  An organization may require administrator approval. A headless server without a keyring cannot
  save login; importing transcript files does not need one.

## Install

```sh
npm install -g @wirecat/zoom-cli
zm --version
zm doctor
```

You should see a version number and local diagnostic results. Neither command logs in or reads
meetings. The package is `@wirecat/zoom-cli`; the shorter command you use is `zm`.

On Windows, if PowerShell blocks `npm.ps1` or `zm.ps1`, use the command launchers instead:

```powershell
npm.cmd install -g @wirecat/zoom-cli
zm.cmd --version
zm.cmd doctor
```

Use `zm.cmd` in the remaining examples if that is the launcher your terminal needs. This does not
require changing PowerShell's execution policy. If the command is not found, reopen the terminal
and check npm's global command directory is on PATH, the folders your terminal searches. Restart
an already-running agent too if it cannot see the newly installed command.

## Choose how to connect

| Your starting point | What to do |
|---|---|
| You already created a Zoom app | [Open its credentials](zoom-app.md#use-an-app-you-already-created), enable Public Client OAuth and copy its **Public Client ID** |
| Your team supplied an app, including a WireCat app | Get its **Public Client ID** from the owner and confirm your Zoom user may authorize it; [use the shared app](zoom-app.md#use-a-wirecat-or-team-app) |
| You need an app | [Create a General, user-managed app](zoom-app.md#create-your-own-app), configure its callback and scopes, then return here |
| You have transcript files | [Import without a Zoom app](#import-without-a-zoom-app); skip browser login |

**There is no credentials file to download.** A Zoom app registers the permissions the tool may
request. It is separate from your Zoom account and the Zoom meeting application. Inside that app,
enable **Use Public Client OAuth** and copy the **Public Client ID**. Do not use its regular Client
ID or Client Secret. You do not create another OAuth client outside the app.

Before login, check the same Development or Production environment as that public ID:

| Setting | Required value |
|---|---|
| App type / management | General app / User-managed |
| Use Public Client OAuth | On |
| OAuth Redirect URL and OAuth Allow Lists | Both include exactly `https://wirecat.dev/zoom-callback` |
| Scopes | All five [hosted-meeting read permissions](zoom-app.md#what-the-manifest-asks-for) for meeting sync |

The [app guide](zoom-app.md) gives the Marketplace steps and explains adding recording permissions.
Installing `zm` does not choose a shared app for you. A development app may be restricted to its
creator's account; its ID alone does not grant access to another person's meetings.

## First run

Replace `<public-client-id>` with your app's Public Client ID, without angle brackets. Run these
commands one at a time in an ordinary terminal. Leave it open while approving in the browser:

```sh
zm config set zoom.client_id <public-client-id>
zm config set source api
zm personal session start
```

1. Sign in to the Zoom account whose hosted meetings you want and review the permissions.
2. Choose **Allow**. Zoom opens the WireCat callback page, which forwards the authorization to
   the waiting tool on this computer.
3. Return to the terminal. Success is `logged_in: true` followed by the shell prompt. Browser
   approval alone does not finish the tool's login.
4. If it keeps waiting, copy the callback page's `code=…&state=…` value or full callback URL,
   paste it into that **same waiting terminal**, and press Enter. Do not paste it into the agent
   chat or start it as a shell command. After the five-minute deadline, start a new login.

The first word, `personal`, is the **profile**: this login and its stored meetings. Retrieve a small period:

```sh
zm personal session status --json
zm personal meetings sync --lookback-days 7
zm personal meetings list --json
```

Session status should show saved credentials with `state: saved`; it does not contact Zoom to
check whether access still works. Sync makes the remote requests and stores available hosted
meeting data. List reads that local copy. Another Zoom user is another profile with its own login. See [sessions and profiles](sessions.md#select-a-local-profile).

If the list is empty, check the Zoom account, dates and [recording/transcript availability](zoom-app.md#before-your-first-zm-meetings-sync).
A meeting someone else hosted never comes through sync: Zoom's API lists only the meetings your login
scheduled, and has no list of meetings you only attended. Ask the host for the transcript file (`.vtt`) and
[import it](#import-without-a-zoom-app); it joins the same store, search and review as a synced meeting. A
missing-scope error names the permission to add; save the app's change and authorize again.

## Import without a Zoom app

Use a `.vtt` transcript downloaded with permission or supplied by the host. Put it directly in a
folder, with a name such as `2026-10-01_1000_example-planning.vtt`. The filename supplies the meeting's
date, time and title; the timezone setting determines how that time is interpreted:

```sh
zm config set files.timezone Europe/Madrid
zm personal meetings import ./downloaded-transcripts
zm personal meetings list --json
```

Replace the folder path and timezone with yours. Import does not recurse into subfolders or infer
attendees from speaker names. No app, browser login or OAuth token is needed. Continue with
[downloaded transcripts](archive.md#downloaded-transcripts) for supported filenames and correction history.

## Give your agent access

A **skill** is the tool's instruction set for an agent with terminal access:

```sh
zm skill install --for agents
```

This installs instructions for Codex/Gemini. For Claude Code use `--for claude`; omit `--for` to
install both. Installing instructions does not authorize Zoom or retrieve meetings. For an agent
using MCP, follow [MCP and skills](mcp.md) instead; its meeting tools are read-only.

## Check your first result

Use a meeting ID returned by list, replacing `<meeting-id>` without angle brackets:

```sh
zm personal meetings show <meeting-id> --json
zm personal meetings transcript <meeting-id> --json
```

You should see the saved meeting and any transcript Zoom supplied or you imported. A meeting can
exist without transcript text; permission alone does not create it. Ask your agent:

```text prompt
Use zm CLI to find the meeting I just imported or retrieved.
Show its date, participants actually recorded, one decision and the passage supporting it.
If no decision is supported, say so. Tell me whether transcript or participant information is missing.
```

A useful answer shows a source reference and the supporting words, with missing information made
clear. For a missing transcript or an unfinished login, follow [troubleshooting](troubleshooting.md).
Once that works, [search a topic and read its surrounding evidence](search.md).

## Where files go

| What | Linux and macOS | Windows |
|---|---|---|
| settings (`config.json`) | `~/.config/zm/` | `%APPDATA%\zm\Config\` |
| state (recorded runs in `runs/`) | `~/.local/share/zm/` | `%LOCALAPPDATA%\zm\Data\` |
| cache | `~/.cache/zm/` | `%LOCALAPPDATA%\zm\Cache\` |
| the local store | `~/.local/share/WireCat/wirecat.db` | `%LOCALAPPDATA%\WireCat\Data\wirecat.db` |

`config.json` holds public settings; it is not a downloaded credentials file. `zm doctor --json`
shows its location. Login tokens stay in your operating system's password store. Recording downloads
go to the destination you name. `ZM_CONFIG_DIR` changes configuration and its keyring service;
`MESSAGING_STORE` selects a different database. See [configuration](configuration.md).

## Update or remove the tool

Update with the same install command, then check the version:

```sh
npm install -g @wirecat/zoom-cli
zm --version
```

Remove the command with:

```sh
npm uninstall -g @wirecat/zoom-cli
```

Uninstalling removes only the package. To remove everything else, delete:

- the settings, state and cache directories: `~/.config/zm`, `~/.local/share/zm` and `~/.cache/zm` on Linux and
  macOS; `%APPDATA%\zm` and `%LOCALAPPDATA%\zm` on Windows;
- the agent skill folders, if you installed the skill: `~/.claude/skills/zoom-cli` and
  `~/.agents/skills/zoom-cli` (`%USERPROFILE%\.claude\skills\zoom-cli` and
  `%USERPROFILE%\.agents\skills\zoom-cli` on Windows);
- the login entry in your password store, described in [sessions](sessions.md#remove-access);
- the shared meeting database and your recording folders, only if you want the saved meetings gone.
  Other WireCat tools use the same database.

Revoke app access in Zoom Marketplace if you also want to withdraw account authorization.
Use the `.cmd` launchers on Windows if needed.

## Shell completion

`zm complete -- <words...>` answers shell completion requests; it does not install completion
into your shell. `zm commands` lists every command by section; `zm commands --json` adds options for agents and
scripts.

After installation, [find a meeting passage](search.md) and check its source before keeping conclusions.
