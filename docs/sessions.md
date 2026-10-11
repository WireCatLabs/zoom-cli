# Login, sessions and profiles

Log in once with your own Zoom app, keep the token in the system keyring, and choose a local profile
label that groups the meetings you store.

## Log in

Follow [the app guide](zoom-app.md). Use Public Client OAuth and redirect to
`https://wirecat.dev/zoom-callback`. Configure the Public Client ID, then log in:

```sh
zm config set zoom.clientId <public-client-id>
zm login --browser firefox
```

The callback returns to a listener on your machine. If it cannot, paste the `code=…&state=…`
parameters shown on the callback page. Login checks the state and PKCE verifier, stores tokens
only in the system keyring, and returns login status and actual granted scopes. A missing keyring
is an error; tokens are never written to a config file. The login listener closes on success,
failure and timeout; the default login deadline is five minutes.

Browser login requires an input terminal. Piped or JSON login also requires `--interactive`; CI and
terminals without interactive input do not launch a browser. `--no-input` refuses browser login.

## Check the session

`zm session status` inspects saved OAuth state separately from local data profiles. It reads cached
login state without refreshing credentials. Remote verification through `session status --check`
explicitly contacts Zoom and requires the corresponding user-read scope (`user:read:user`).

Missing-scope errors name the required scope. Add it in your Zoom app, then log in again; existing
tokens do not gain newly configured scopes automatically.

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

Import and pull register the selected profile when ingestion begins. Read commands look up an
existing profile and never register an account; import transcripts or pull first if no stored
meetings exist. `MESSAGING_STORE` overrides the shared database path for all these commands and MCP
reads. Metadata, help, configuration and login commands do not open the database.
