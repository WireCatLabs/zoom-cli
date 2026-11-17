### Changed — may break callers

- **A keyring that does not answer is named, not taken for "not signed in".** When the OS keyring fails (on Linux a
  restarted session bus is a known cause) and the sign-in file holds no entry, `session status`, `session end` and
  `account remove` answer `keyring.unreachable` with the fix: log out and back in, or set
  `DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG_RUNTIME_DIR/bus`. Before, `session end` said there was nothing to end while
  the sign-in stayed in the keyring.
- **Built on cli-core 0.687.0 and cli-base 0.109.0** (were 0.683.0 and 0.107.0). See the
  [cli-core changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md) and the
  [cli-base changelog](https://github.com/WireCatLabs/cli-base/blob/main/CHANGELOG.md).

### Fixed

- **`meetings passage` marks transcript text in a scheduled agent's run.** Under the read-only lock with an untrusted
  mark set, the text and Markdown output wrap each cue's speaker and words in untrusted marks, as JSON already did.
