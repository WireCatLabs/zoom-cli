### Added

- **`zm session list` lists the profiles on this computer** and the state of each one's saved Zoom login, with no
  profile named and without contacting Zoom. zm now has all four session commands
  ([WC-ACCT-12](https://github.com/WireCatLabs/cli-base/blob/main/docs/standards/accounts.md#wc-acct-12--sign-in-is-session-start-status-and-end-and-session-list-names-the-profiles)).

### Fixed

- **WireCat Desktop runs zm's sync, check and sign-in for the profile it means.** zm's manifest listed no profiles,
  so it left the profile word out of `doctor`, `session start` and `meetings sync`. It now lists them with
  `session list` and puts `{profile}` first in each, and it describes `account remove` for Desktop too.
