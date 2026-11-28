# Troubleshooting

Get back to your meetings when the login is stuck after you approved in the browser, a meeting or transcript is
missing, or a download stopped. Each case here has a check and a fix.

Find your symptom, make the smallest fix and repeat the check it names. Keep recording files that already downloaded,
and look at a meeting in Zoom before you repeat a change whose result was uncertain.

**On this page:**

1. [Login](#login)
2. [Configuration](#configuration)
3. [Zoom replies](#zoom-replies)
4. [Missing meetings or transcripts](#missing-meetings-or-transcripts)
5. [Archives](#archives)
6. [A meeting change may not have applied](#remote-meeting-changes)

## Login

### I approved in the browser, but the terminal is still waiting

The browser approved the app, but its callback has not reached the waiting process. Start a new login with
`zm personal session start --answer-stdin`, approve again, copy the full callback URL from the browser, paste it
into **that same terminal**, and press Enter. The command must report `signed_in: true` and return to the prompt.
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

The login always prints its URL as `Open Zoom sign-in: …`. Open that URL in any browser on this computer
while the login waits. Do not reuse an old URL. `--no-browser` skips the browser and only prints the URL.

### The app is unavailable or needs administrator approval

Check that the Zoom user can install this app. A development app is not automatically available
outside its developer account. Ask the app owner or company administrator to approve the appropriate
access; creating a second app does not bypass company policy. [Existing-app reuse](zoom-app.md#use-an-app-you-already-created)
shows the settings to check. Authorized VTT files can still be imported without API login.

### Login says it could not reach the OS keyring

The system password store is locked, not running, or not reachable from this session (a headless
machine, an agent's shell, `ssh`). Login still works: it keeps the tokens in `credentials.json` in
zm's config folder, readable by you only, and says so once. To move them back,
unlock the keyring and run `session start` again from a desktop session.

### Commands stop with "Zoom token request failed"

Each token request records its outcome in `~/.local/share/zoom-cli/runs/<date>/<run>/events.jsonl` (the
`runs` folder under `ZM_STATE_DIR` when it is set). A record holds the HTTP status, whether Zoom sent
a new refresh token, whether the keyring save worked, a timeout or cancellation, and the process id.
It never holds a token. Two records with different process ids close together suggest two commands
refreshing at once. Read them with `cat ~/.local/share/zoom-cli/runs/*/*/events.jsonl`, then run
`zm personal session start` again. A successful run is kept 7 days and a failed one 30
([run log](configuration.md#run-log)).

### A required scope is missing

The error names the exact permission. The app owner adds it in **Scopes** and saves; then the user
runs `zm personal session start` again. Check the granted scopes with `zm personal session status --json` and retry the failed
read. Tokens already issued do not gain newly configured scopes. Archive, meeting details from Zoom,
session checks with Zoom and meeting changes have [separate permissions](zoom-app.md#add-archive-or-management-access).

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
| No stored profile or empty list (exit 3, "no stored meetings for the selected profile") | Choose a profile and import or sync; reads do not register accounts | `zm personal meetings list --json` shows the selected profile's meetings |
| No hosted meetings in the recent window | Confirm the logged-in Zoom user, API source and date range; try an older explicit `--since-time` | Compare returned dates with expected hosted occurrences |
| Meeting exists but transcript is empty | Check Zoom's transcript generation/retention and host permissions; a sync cannot recreate expired or never-saved text | Open the transcript after Zoom makes it available and you sync again |
| A meeting someone else hosted is missing | Sync never reads it: Zoom's API lists only meetings you scheduled. Ask the host for the VTT file, then `meetings import` it | Check imported date/title and text |
| Transcript appeared after the first sync | Revisit with `zm personal meetings sync --lookback-days 7`, or an older explicit `--since-time` | Open the newly stored transcript |
| Sync failed partway | Repair the reported error and retry; failed occurrences do not advance the cursor | Inspect the completion receipt and meeting list |
| Import rejects a filename or time | Use `YYYY-MM-DD_HHMM_topic.vtt` and the filename's timezone; resolve conflicting or ambiguous times | Import succeeds with the intended date/title |
| Search gives no matches | Check transcript availability, selected profile and indexing coverage before changing the query | Open a known passage and confirm its indexed/searchable state |

Run one sync at a time for the same account. See [transcript settings](zoom-app.md#before-your-first-zm-meetings-sync),
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

<a id="remote-meeting-changes" />

## A meeting change may not have applied

Exit code 14 means a write was sent and its result is uncertain. Look at the meeting in Zoom
before repeating the change; the CLI never automatically retries remote writes.
After resolving the symptom, repeat the smallest relevant read to confirm recovery, then return to
[your meeting task](usage.md).
