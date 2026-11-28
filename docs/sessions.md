# Login, sessions and profiles

Sign in to the right Zoom account once and keep its meetings apart from any other account's. A login stays on this
computer, so later commands and your agent reach Zoom without asking you again.

Each Zoom account gets a profile: a short name such as `personal` or `work`, which every command starts with. The name
is only a label, so renaming a profile never signs you in as another Zoom user.

**On this page:**

1. [Log in](#log-in)
2. [Finish the browser callback](#finish-the-browser-callback)
3. [Check the session](#check-the-session)
4. [Select a local profile](#select-a-local-profile)
5. [Remove access](#remove-access)

## Log in

Have the Public Client ID from [an existing or new Zoom app](zoom-app.md). Run login in an
interactive terminal on the computer that will store the session, with your own ID in place of the example:

```sh
zm config set zoom.client_id AbCdEf123456
zm personal session start
```

Agents: run `zm personal session start` in the background (it waits up to five minutes for the approval, and a shell
tool shows nothing until the command exits), read the line `Open Zoom sign-in:` and the URL after it, and give the
URL to the person as a link. The browser that opens it must be on this computer, because
the callback reaches a listener here. `--quiet` keeps the URL.

The default browser opens. `--no-browser` only prints the URL. Zoom displays the app's requested permissions;
sign in to the intended account and approve. The tool stores tokens in the operating system's
keyring, never the public configuration file. If that password store is unavailable, login keeps them in
`credentials.json` in zm's config folder, readable by you only, says so once on stderr; it never asks. `--credential-storage file` chooses the file outright. The keyring is
safer, so use the file only where no keyring runs. The next `session start` that reaches the keyring moves the tokens back.

If `zm personal session status` shows `state: missing` after an update, run `zm personal session start` again.

## Finish the browser callback

Leave the terminal running. After **Allow**, the callback page at `https://wirecat.dev/zoom-callback`
forwards the response to a temporary listener on your computer. Successful receipt closes the listener;
the command reports `signed_in: true` with granted scopes and returns to the shell prompt.

If the browser may not come back to this computer, start the login with `--answer-stdin`:

1. Run `zm personal session start --answer-stdin`. It asks for the address the browser shows after you allow access.
2. Copy the full callback URL from the browser and paste it into **that same terminal**, then press Enter. Do not
   start another process or paste the value as a new shell command.
3. If the five-minute deadline expired, run login again and use the new callback. Each attempt has
   its own state and verification key; a callback from an older attempt is rejected.

A browser on another device, a remote terminal or browser restrictions on local connections can
require this paste path. Do not put the callback in a public report or an agent conversation;
it belongs to the active login attempt. Approval is complete only after the terminal confirms it.

## Check the session

```sh
zm personal session status --json
```

This checks cached keyring state without contacting Zoom or refreshing tokens. `state: saved`
means credentials are saved; it is not a remote validity check. The returned scopes show what was
granted. For a remote check, add the `user:read:user` scope in the app, authorize again, then run:

```sh
zm personal session status --check --json
```

Missing-scope errors name the required permission. The app owner adds it, saves the app and the
user runs `zm personal session start` again. Configuration changes alone do not expand an existing token's scope.

Without a terminal, with `--no-input` or in CI, login opens no browser. It still prints the URL and waits for
the callback, and with `--json --answer-stdin` it asks for the redirected address as a `needs` line. Login is not an
MCP tool.

## Select a local profile

```sh
zm personal meetings list
ZM_PROFILE=personal zm meetings list
```

The first word is the profile, as in `tg` and `max`; `ZM_PROFILE` says the same for a whole shell
session. A profile is one Zoom login and its own meetings in the store. Nothing picks one for you:
without a profile, a command that uses an account fails with `validation_error` and lists the
profiles here in `details.profiles`. Names have 1–64 letters, digits, dots, underscores or hyphens
and start with a letter or digit; a command word such as `meetings` cannot be a profile.

`zm <name> session start` logs that profile in and makes it. On a computer with no profile yet, the first import or
sync makes one too, so a files-only setup needs no Zoom login. Beside other profiles, an import or sync that names an
unknown one is refused before anything is stored — `zm persnal meetings import …` fails and lists the profiles —
so a new account starts with its login; `zm <name> config set permissions '{}'` also makes a profile, for one
that only imports files. Read commands only look a profile up: sync or import once before expecting
`meetings list` to find it.

For another Zoom user, start a second profile — `zm work session start` — and choose that user in
the browser. Each profile's login is its own keyring entry, `oauth:zoom:<profile>` under the service `zoom-cli`.
Older versions kept logins under `zoom-cli:<configuration directory>` as `<client id>:<profile>`; the
first run copies one to the new entry and leaves the old one until `session end`.

`zm session list --json` lists the profiles on this computer and the state of each one's saved login (`saved`,
`missing`, or `unknown` when the keyring cannot be read). It takes no profile and does not contact Zoom.
`zm <profile> session status` gives `expires_at`, when the access token runs out; a refresh moves it on.

`ZM_PROFILE_LOCK=personal` pins a process to one profile: a first word or `ZM_PROFILE` naming any
other is refused with `permission_error`. Set it where an agent runs.

`MESSAGING_STORE` selects the shared database. Use the same path for Zoom, `wcat`, `files` and your MCP
client when connecting meeting evidence with notes and projects. File imports do not advance
the sync cursor; when switching ingestion sources, an older explicit `--since-time` may be needed.

## Remove access

`zm <profile> session end` deletes that profile's login from this computer, the entry an older version made included, and
keeps its meetings. It does not withdraw the app's access in Zoom: remove or revoke the app in Zoom App Marketplace's
app management for that. Uninstalling `zm` does not revoke Zoom authorization or erase saved meetings. See
[security](security.md) before sharing data with an agent.

Several Zoom users on one computer are several profiles: each has its own keyring entry and its own meetings.

Once the session and profile are ready, [sync or import your first meeting](archive.md#pull-hosted-meetings).
