# Installation

Install `zm`, register your own Zoom app, log in and choose a local profile. Afterwards `zm pull`
fetches your hosted meetings and an agent can read them.

## What it needs

- **Node 22.16 or newer within 22.x, or Node 24 or newer.** The command also runs on Bun.
- Linux, macOS or Windows. Automatic daily archive jobs install only on Linux (systemd user timers).
- A system keyring. Login stores tokens only there; a missing keyring is an error, and tokens are
  never written to a config file.
- **Your own Zoom app** with Public Client OAuth — [the app guide](zoom-app.md) takes a few minutes.
  A company-managed Zoom account may need an admin to approve it.

## Install

```sh
npm install -g @wirecat/zoom-cli
zm --version
```

`--help` and `--version` work without a configured app or login. `zm doctor` checks the local runtime
and public configuration without logging in or opening the database.

## First run

```sh
zm config set zoom.clientId <public-client-id>
zm login
zm config set account.profile personal
zm pull --lookback-days 7
zm meetings list
```

[Sessions](sessions.md) covers login and profiles, [the archive](archive.md) covers pulling,
importing and recording downloads. To give an agent the tool, see [MCP and skills](mcp.md).

## Where files go

Directories follow the platform convention. `ZM_CONFIG_DIR` overrides
the configuration directory; changing it also changes the keyring service used for login.
Meeting data lives in the shared WireCat database (`wirecat.db`), which other WireCat tools also use;
`MESSAGING_STORE` selects an explicit database path. See [configuration](configuration.md).

## Shell completion

`zm complete -- <words...>` answers shell completion requests and emits its shell protocol unless
JSON is requested. `zm commands --json` lists every command's arguments, flags and examples.
