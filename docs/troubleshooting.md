# Troubleshooting

Recover when login stalls, data is missing or an archive operation fails. Start with the symptom
below, make the smallest relevant correction and repeat the stated check. Preserve completed
recording files and inspect an uncertain remote change before retrying it.

## Login

### I approved in the browser, but the terminal is still waiting

The browser approved the app, but its callback has not reached the waiting process. Leave that
terminal open. On the WireCat callback page, copy `code=…&state=…` or the full callback URL, paste
it into **the same running `zm personal session start` terminal**, and press Enter. The command must report
`logged_in: true` and return to the prompt. If it timed out, start a new login and use its new callback.
A callback from an earlier attempt cannot finish a later one.

A browser on another device or a remote terminal can prevent automatic local forwarding.
[Sessions](sessions.md#finish-the-browser-callback) explains completion and its five-minute deadline.

### Zoom says "Invalid redirect"

Open the app's selected Development or Production environment. Check **OAuth Redirect URL** and
**OAuth Allow Lists** both contain `https://wirecat.dev/zoom-callback`, and enable **Use Public
Client OAuth**. Copy its **Public Client ID**, configure it and run login again. The regular Client
ID is a different value. The manifest is a starter and does not enable public-client mode or scopes.
Use [the full app checklist](zoom-app.md#create-your-own-app), then verify terminal completion.

### The browser does not start

Try an installed browser explicitly:

```sh
zm personal session start --browser firefox
```

In an interactive terminal, open the authorization URL printed by that running login yourself,
then paste its callback if necessary. Do not reuse an old URL. Without paste input, browser launch
failure exits promptly. Without a terminal the URL is still printed; `--no-input` and CI refuse login.

### The app is unavailable or needs administrator approval

Check that the Zoom user can install this app. A development app is not automatically available
outside its developer account. Ask the app owner or company administrator to approve the appropriate
access; creating a second app does not bypass company policy. [Existing-app reuse](zoom-app.md#use-an-app-you-already-created)
shows the settings to check. Authorized VTT files can still be imported without API login.

### Login reports a keyring error

The system password store must be installed, running and accessible to this user. Log in from the
same operating-system account/session where the keyring is available; a headless environment may
lack it. The tool does not fall back to a plaintext token file. After repairing keyring access,
run login again and check `zm personal session status --json`.

### Commands stop with "Zoom token request failed"

Each token request records its outcome in `~/.local/share/zm/runs/<date>/<run>/events.jsonl` (the
`runs` folder under `ZM_STATE_DIR` when it is set). A record holds the HTTP status, whether Zoom sent
a new refresh token, whether the keyring save worked, a timeout or cancellation, and the process id.
It never holds a token. Two records with different process ids close together suggest two commands
refreshing at once. Read them with `cat ~/.local/share/zm/runs/*/*/events.jsonl`, then run
`zm personal session start` again. Runs older than 30 days are removed.

### A required scope is missing

The error names the exact permission. The app owner adds it in **Scopes** and saves; then the user
runs `zm personal session start` again. Check the granted scopes with `zm personal session status --json` and retry the failed
read. Tokens already issued do not gain newly configured scopes. Archive, remote meeting details,
remote verification and meeting changes have [separate permissions](zoom-app.md#add-archive-or-management-access).

## Configuration

Use `zm config show` to confirm the public client, source and profile. A configuration with problems
still allows `--help`, `--version`, `zm config` and `zm doctor`; other commands stop on the first problem and say how
to remove it. `zm doctor --json` lists every problem under `config.issues`, each with its `fix` when a command can
remove it, and `zm config show` prints them after the settings that still load. Changing the profile
label does not change the logged-in Zoom user. If the terminal and MCP app see different data,
check their `ZM_CONFIG_DIR` and `MESSAGING_STORE` values.

## Zoom replies

A network failure reports a provider error; an invalid response is reported separately. Check
connectivity and whether you used `--offline` for a command that needs Zoom. Diagnostics exclude raw
provider error text. Keep the command, error code and scope name when reporting a problem; exclude
OAuth callback values, tokens and private transcript text.

## Missing meetings or transcripts

| Symptom | Check and repair | Success check |
|---|---|---|
| No stored profile or empty list (exit 3, "no stored meetings for the selected profile") | Choose a profile and import or pull; reads do not register accounts | `zm personal meetings list --json` shows the selected profile's meetings |
| No hosted meetings in the recent window | Confirm the logged-in Zoom user, API source and date range; try an older explicit `--since-time` | Compare returned dates with expected hosted occurrences |
| Meeting exists but transcript is empty | Check Zoom's transcript generation/retention and host permissions; expired or never-saved text cannot be recreated by pull | Open the transcript after Zoom makes it available and you pull again |
| A meeting someone else hosted is missing | Sync never reads it: Zoom's API lists only meetings you scheduled. Ask the host for the VTT file, then `meetings import` it | Check imported date/title and text |
| Transcript appeared after the first pull | Revisit with `zm personal meetings sync --lookback-days 7`, or an older explicit `--since-time` | Open the newly stored transcript |
| Pull failed partway | Repair the reported error and retry; failed occurrences do not advance the cursor | Inspect the completion receipt and meeting list |
| Import rejects a filename or time | Use `YYYY-MM-DD_HHMM_topic.vtt` and the filename's timezone; resolve conflicting or ambiguous times | Import succeeds with the intended date/title |
| Search gives no matches | Check transcript availability, selected profile and indexing coverage before changing the query | Open a known passage and confirm its indexed/searchable state |

Serialize pulls for the same account. See [transcript settings](zoom-app.md#before-your-first-zm-meetings-sync),
[file import](archive.md#downloaded-transcripts) and [search coverage](search.md#start-with-a-question).

## Archives

- **No downloadable cloud files:** check recording dates, host account, recording availability and
  the recording scopes. A transcript and a cloud recording are different sources.
- **A lock remains after a crash:** inspect `recordings archive locks`, preview
  `recordings archive recover`, then add `--yes` only for recognized dead-process locks.
  Active and foreign locks are preserved. See [locks and recovery](archive.md#locks-and-recovery).
- **A checksum mismatch:** preserve the existing files and use a new destination. Downloads never
  overwrite conflicting content. Run archive verification afterwards.
- **A download stopped:** repeat it with the same selected profile/destination to use supported
  verified resume. A checkpoint is progress history, not an integrity check; verify finished files.

## Remote meeting changes

Exit code 14 means a write was dispatched and its result is uncertain. Read the remote meeting or
inspect Zoom before repeating the change; the CLI never automatically retries remote writes.
After resolving the symptom, repeat the smallest relevant read to confirm recovery, then return to
[your meeting task](usage.md).
