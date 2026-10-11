# Login, sessions and profiles

Connect the intended Zoom account and check that browser approval reached the command-line tool.
Then choose a local profile to keep its saved meetings together. App permission, an OAuth session
and a profile are three separate things: changing a profile label does not log in to another user.

## Log in

Have the Public Client ID from [an existing or new Zoom app](zoom-app.md). Run login in an
interactive terminal on the computer that will store the session:

```sh
zm config set zoom.clientId <public-client-id>
zm login --browser firefox
```

Omit `--browser firefox` to use the default browser. Zoom displays the app's requested permissions;
sign in to the intended account and approve. The tool stores tokens in the operating system's
keyring, never the public configuration file. If that password store is unavailable, login fails.

## Finish the browser callback

Leave the terminal running. After **Allow**, the callback page at `https://wirecat.dev/zoom-callback`
forwards the response to a temporary listener on your computer. Successful receipt closes the listener;
the command reports `loggedIn: true` with granted scopes and returns to the shell prompt.

If nothing appears in the terminal after approval:

1. Look at the callback page in the browser. Copy the displayed `code=…&state=…` parameters or its
   full callback URL.
2. Paste into the **same terminal still waiting in `zm login`**, then press Enter. Do not start
   another process or paste the value as a new shell command.
3. If the five-minute deadline expired, run login again and use the new callback. Each attempt has
   its own state and verification key; a callback from an older attempt is rejected.

A browser on another device, a remote terminal or browser restrictions on local connections can
require this paste path. Do not put the callback in a public report or an agent conversation;
it belongs to the active login attempt. Approval is complete only after the terminal confirms it.

## Check the session

```sh
zm session status --json
```

This checks cached keyring state without contacting Zoom or refreshing tokens. `loggedIn: true`
means credentials are saved; it is not a remote validity check. The returned scopes show what was
granted. For a remote check, add the `user:read:user` scope in the app, authorize again, then run:

```sh
zm session status --check --json
```

Missing-scope errors name the required permission. The app owner adds it, saves the app and the
user runs `zm login` again. Configuration changes alone do not expand an existing token's scope.

Browser login requires interactive input. Piped output or `--json` login also requires
`--interactive`; `--no-input` refuses browser login. Keep initial connection in an ordinary
terminal, rather than a background job or an MCP client.

## Select a local profile

```sh
zm config set account.profile personal
```

A profile is a label for saved data, not a separate set of Zoom credentials. Labels have 1–64
letters, digits, dots, underscores or hyphens and start with a letter or digit. Import and API
pull share the selected label; ingestion registers it, while read commands only look it up.
Pull or import once before expecting `meetings list` to find it.

When switching to another Zoom user, select a separate data profile **and** run login, choosing
that user in the browser. Do not pull different users into the same label. The keyring entry is
selected by configuration directory and public client ID; changing only `account.profile` keeps
the existing OAuth credentials.

`MESSAGING_STORE` selects the shared database. Use the same path for Zoom, Memo and your MCP
client when connecting meeting evidence with notes and projects. File imports do not advance
the pull cursor; when switching ingestion sources, an older explicit `--since` may be needed.

## Remove access

There is no logout command. To withdraw the app's account access, remove/revoke the app in Zoom
App Marketplace's app management. If you also want to remove the local token, use your operating
system's password-store interface for this tool's entry. Uninstalling `zm` does not revoke Zoom
authorization or erase saved meetings. See [security](security.md) before sharing data with an agent.

Once the session and profile are ready, [pull or import your first meeting](archive.md#pull-hosted-meetings).
