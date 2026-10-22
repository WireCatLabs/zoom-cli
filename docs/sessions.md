# Login, sessions and profiles

Connect the intended Zoom account and check that browser approval reached the command-line tool.
Then choose a local profile to keep its saved meetings together. App permission, an OAuth session
and a profile are three separate things: changing a profile label does not log in to another user.

## Log in

Have the Public Client ID from [an existing or new Zoom app](zoom-app.md). Run login in an
interactive terminal on the computer that will store the session:

```sh
zm config set zoom.client_id <public-client-id>
zm personal session start --browser firefox
```

Agents: run `zm personal session start` in the background (it waits up to five minutes for the approval, and a shell
tool shows nothing until the command exits), read the line `Open this URL to approve Zoom login:` and the URL
under it, and give the URL to the person as a link. The browser that opens it must be on this computer, because
the callback reaches a listener here. `--quiet` keeps the URL.

Omit `--browser firefox` to use the default browser. Zoom displays the app's requested permissions;
sign in to the intended account and approve. The tool stores tokens in the operating system's
keyring, never the public configuration file. If that password store is unavailable, login fails.

## Finish the browser callback

Leave the terminal running. After **Allow**, the callback page at `https://wirecat.dev/zoom-callback`
forwards the response to a temporary listener on your computer. Successful receipt closes the listener;
the command reports `logged_in: true` with granted scopes and returns to the shell prompt.

If nothing appears in the terminal after approval:

1. Look at the callback page in the browser. Copy the displayed `code=…&state=…` parameters or its
   full callback URL.
2. Paste into the **same terminal still waiting in `zm personal session start`**, then press Enter. Do not start
   another process or paste the value as a new shell command.
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

Without a terminal, login still prints the URL and waits for the callback; only the paste fallback needs a
terminal. `--no-input` and CI refuse browser login. Login is not an MCP tool.

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
pull makes one too, so a files-only setup needs no Zoom login. Beside other profiles, an import or pull that names an
unknown one is refused before anything is stored — `zm persnal meetings import …` fails and lists the profiles —
so a new account starts with its login; `zm <name> config set permissions '{}'` also makes a profile, for one
that only imports files. Read commands only look a profile up: pull or import once before expecting
`meetings list` to find it.

For another Zoom user, start a second profile — `zm work session start` — and choose that user in
the browser. Each profile's login is its own keyring entry, `<client id>:<profile>`.

`ZM_PROFILE_LOCK=personal` pins a process to one profile: a first word or `ZM_PROFILE` naming any
other is refused with `permission_error`. Set it where an agent runs.

### Upgrading from 0.34 and earlier

The old `account.profile` setting is no longer read to pick a profile, and `zm config set
account.profile` is refused. Its value still appears among the profiles, and the login saved before
the upgrade moves to that profile the first time you use it: `zm personal meetings sync`.

`MESSAGING_STORE` selects the shared database. Use the same path for Zoom, Memo and your MCP
client when connecting meeting evidence with notes and projects. File imports do not advance
the pull cursor; when switching ingestion sources, an older explicit `--since-time` may be needed.

## Remove access

There is no logout command. To withdraw the app's account access, remove/revoke the app in Zoom
App Marketplace's app management. To remove the local token, open your operating system's password store and delete the entry
whose service is `zoom-cli:<configuration directory>` (for example `zoom-cli:/home/you/.config/zm`;
`zm doctor --json` shows the directory) and whose account is `<Public Client ID>:<profile>`. A login saved by 0.34 or
earlier has the Public Client ID alone as its account; once the profile has taken it over, that old entry is unused and
can be deleted. Uninstalling `zm` does not revoke Zoom authorization or erase saved meetings. See
[security](security.md) before sharing data with an agent.

Several Zoom users on one computer are several profiles: each has its own keyring entry and its own meetings.

Once the session and profile are ready, [pull or import your first meeting](archive.md#pull-hosted-meetings).
