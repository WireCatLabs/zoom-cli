### Security

- **One keyring entry per profile, shared by every run.** A sign-in is kept under the service `zoom-cli`, account
  `oauth:zoom:<profile>`, not under one service per config folder. The first run copies an older entry there and
  leaves the old one until `session end`, which now deletes both. A run with moved folders (`ZM_CONFIG_DIR`, a
  throwaway `HOME`) reads the owner's sign-in but never replaces or deletes it
  ([sessions](../docs/sessions.md#remove-access)).
- **One token refresh at a time across processes.** The archive timer, an MCP server and a command in a terminal no
  longer refresh the same sign-in at once. Zoom replaces the refresh token on each refresh, so the loser of that race
  could sign the owner out.
- **zm reaches only Zoom's hosts.** Every request goes through cli-base's `hostFetch`, limited to `zoom.us`,
  `zoom.com` and their subdomains. `contracts/wirecat.json` lists them for WireCat Desktop.

### Changed — may break callers

- **zm keeps its folders under `zoom-cli`, the name `zm doctor` and the run log already used.** Settings move from
  `~/.config/zm` to `~/.config/zoom-cli`, and state from `~/.local/share/zm` to `~/.local/share/zoom-cli`. The first
  run moves them and leaves a link at each old folder it emptied, so an older zm still works; a saved archive
  schedule keeps running ([configuration](../docs/configuration.md)).
- **A sign-in no longer depends on the client ID in its keyring name.** After changing `zoom.client_id`, run
  `zm <profile> session start` again.

### Fixed

- **Zoom requests retry through cli-base's shared retry**, with the same two retries and Zoom's `Retry-After`.
- **The docs say where the login really is:** the keyring, or a private file when the keyring is unavailable, and
  `session end` removes it.
