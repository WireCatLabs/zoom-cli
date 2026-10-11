# Troubleshooting

What you see, and what to do about it.

## Login

- **The browser does not start.** Select an installed browser with `--browser firefox`. In an
  interactive terminal, you can also paste the callback parameters. Without paste input, a launch
  failure exits promptly.
- **Zoom says "Invalid redirect".** The manifest import can leave the redirect URL, the allow list or
  Public Client OAuth unset; see steps 5 and 6 of [the app guide](zoom-app.md#create-it-from-the-manifest).
- **The callback page shows `code=…&state=…`.** The browser could not reach the listener on your
  machine; paste those parameters into `zm login`.
- **Login does not open a browser in CI or a pipe.** Browser login requires an input terminal; piped
  or JSON login also requires `--interactive`.
- **A missing-scope error.** The error names the required scope. Add it in your Zoom app, then log in
  again.
- **Your company manages your Zoom account.** An admin may have to approve the app. Until then,
  `zm import` still works with downloaded transcript files.

## Configuration

A malformed config still allows `--help` and `--version`; config commands report the error.

## Zoom replies

A network failure reports a provider error; malformed provider replies report an invalid response.
Diagnostic messages exclude raw provider error text.

## Missing meetings or transcripts

- **No transcripts at all.** Turn on **Allow hosts to retain transcripts** in Zoom's web settings.
- **Meetings you attended are missing.** Zoom returns transcripts only for meetings you hosted. Download
  the transcripts from your Zoom portal and run `zm import <folder>`.
- **A transcript appeared later than its meeting.** Use `pull --lookback-days 7` to revisit the last
  seven days, or an older explicit `pull --since 2026-10-01` for earlier occurrences. The cursor alone
  does not guarantee that late transcripts are revisited.
- **A pull failed partway.** A failed occurrence leaves the cursor unchanged so the next pull can retry
  it. Serialize pulls for the same account to avoid concurrent event creation.
- **A read command finds no profile.** Read commands never register an account; import transcripts or
  pull first.

## Archives

- **A writer lock remains after a crash.** Inspect `recordings archive locks`, preview
  `recordings archive recover`, and add `--yes` to remove recognized locks owned by a dead process
  ([locks and recovery](archive.md#locks-and-recovery)).
- **A download reports a mismatch.** Existing files are never overwritten; use a new destination.

## Remote meeting changes

If a write was dispatched and its result is uncertain, the CLI exits with code 14. Inspect Zoom
before repeating it; remote writes are never automatically retried.
