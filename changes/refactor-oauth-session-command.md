### Changed — may break callers

- **`zm session` is cli-core's shared session command now** (`oauthSessionCommand`, cli-core 2.0.0, was 1.0.0). zm
  reads the sign-ins it kept before, so nobody signs in again: the entry `oauth:zoom:<profile>` and the older
  `<client id>:<profile>` entry under the config folder's own service, which the first read copies. The answers
  take the shape every WireCat CLI with a browser sign-in gives. Watch for these fields:
  - `session start` answers `signed_in` (was `logged_in`), with `user_id`, `email` and `display_name` from Zoom.
    `credential_storage` is gone. `--browser <program>` is gone: `--no-browser` prints the URL instead.
  - `session start` checks the account at Zoom's `/users/me` before it keeps the sign-in. An app without the
    optional `user:read:user` scope still signs in. A network failure there fails the sign-in.
  - A browser that does not start no longer ends `session start`: it prints `Open Zoom sign-in: <url>` and waits.
    `--no-input` and CI open no browser and wait the same way. To paste the address the browser ends on, start with
    `--answer-stdin`. The paste prompt at a terminal without it is gone.
  - `session status` gives `expires_at` as an ISO time (was `expiresAt` in milliseconds) and `state` `saved` or
    `missing`. `configured`, `zoom_user` and the states `expired`, `verified` and `not_configured` are gone. With
    `--check` the Zoom user is in `user_id`, `email` and `display_name`.
  - `session list` rows are `profile`, `signed_in` and `state` (`saved`, `missing` or `unknown`). `expires_at`,
    `scopes` and the states `expired` and `not_configured` are gone.
  - `session end` answers `removed`, and `why` when the sign-in stays (was `meetings: "retained"`).
  - A run with moved folders (`ZM_CONFIG_DIR`, a throwaway `HOME`) no longer refreshes an expired access token:
    Zoom replaces the refresh token on every refresh, and the owner's own sign-in would keep a dead one. It fails
    with `authentication_error` (`oauth.moved-rotating`). Run the command in the normal run.
  - The run log records a token refresh as cli-core's `oauth.token` (was `zoom.token.exchange`).
- **`zm complete` is cli-core's shared completion.** `zm complete zsh` prints the script to source, and a shell asks
  with `zm complete -- <words>`. The JSON answer is gone.
- **The package no longer exports `login` and `LoginOptions`.** `TokenManager` reads a profile's sign-in only, after
  `forProfile`. `storedIn`, `storageOf` and `exchange` are gone.
- **zm runs on cli-core 2.0, which moves the shared store to version 78** the first time zm opens it; only tools on
  cli-core 2.0 open it after that. Agents are `agent` and sender bots `bot:` in the store. Watch for: upgrade every
  installed WireCat CLI to its cli-core 2.0 release, and stop `serve`, `mcp` and every sync while the store migrates.
  See [cli-core's changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).
