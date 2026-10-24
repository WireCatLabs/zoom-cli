# The local archive

Keep meeting text searchable and back up recording files before Zoom's retention removes them.
Choose whether to retrieve hosted meeting information, import a transcript you already have or
archive cloud audio and video. Text stored in the meeting database and media files in an archive
folder are separate copies; a recording backup is not automatically searchable in the database.

## Choose what to keep

| Source you have | Use | Check afterwards |
|---|---|---|
| Hosted meetings available to your app | `zm personal meetings sync --lookback-days 7` | List meetings, open one transcript and inspect missing parts |
| Downloaded VTT transcript files | `zm personal meetings import ./downloaded-transcripts` | Compare the imported date/title with the original |
| Cloud recording assets | Recording list or download | Verify the destination manifest and checksums |
| Archived VTT files to add to search | Archive import | Check its receipt, then search the stored text |

For the API paths, connect the app with the [permissions for that task](zoom-app.md#add-archive-or-management-access).
File import and local archive inspection do not need browser login. Start with one meeting before
setting up repeated retrieval or a daily backup.

## Where meetings are stored

Login, cloud recording downloads and remote meeting commands work independently of the meeting
database. Import, pull, folder watching and meeting reads use the published shared SQLite adapter.
Store connections open lazily and close before successful results are emitted. Meeting data persists
in the shared WireCat database; `MESSAGING_STORE` selects an explicit database path. The shared model,
exports and ingestion loop come from `@wirecat/cli-core/meetings`.

The shared store uses `wirecat.db`. Store opens preserve legacy `messages.db` files and their
`-wal` and `-shm` sidecars. Manage legacy-file retention separately from importing or reading meetings.

Select a [local profile](sessions.md#select-a-local-profile) before importing or pulling.

## Pull hosted meetings

With the API source selected, pull a recent period and inspect the result:

```sh
zm config set source api
zm personal meetings sync --lookback-days 7
zm personal meetings list --json
zm personal meetings transcript <meeting-id> --json
```

Use an ID from the list. `zm personal meetings sync` retrieves hosted occurrences with available participants,
transcripts and AI summaries. It does not create missing transcripts. Check Zoom's
[generation and retention settings](zoom-app.md#before-your-first-zm-meetings-sync) if the text is absent.

Use `meetings sync --lookback-days 7` to revisit the last seven days, or an older explicit
`meetings sync --since-time 2026-10-01` for earlier occurrences whose transcript appeared later. The cursor alone
does not guarantee that late transcripts are revisited. Serialize pulls for the same account to avoid
concurrent event creation. A failed occurrence leaves the cursor unchanged so the next pull can retry it.

## Downloaded transcripts

For a meeting you only attended, obtain a VTT file from the host or download it if your Zoom
permissions allow. Attendance does not guarantee transcript access. Put the file directly in your
chosen folder and rename it with the meeting date/time/title, for example
`2026-10-01_1000_example-planning.vtt`. Renaming does not change its transcript contents.

```sh
zm config set files.timezone Europe/Madrid
zm personal meetings import ./downloaded-transcripts
zm personal meetings list --json
```

The files source reads `.vtt` and `.txt` files directly inside a folder, without recursion.
Names use `YYYY-MM-DD_HHMM_topic-slug.vtt` or `.txt`. A `.txt` is the form zoom-searcher wrote: a header
(`Встреча:` title, `Дата:` start, `Zoom ID:`, `Говорят:` speakers), then `[hh:mm:ss] Speaker: text` lines. Its
title replaces the one in the file name; its time (like the file name's) is when the recording ended, so the start is that less the last line's offset, its Zoom meeting ID becomes the series key, and its speakers
become participants of that meeting only, keyed by name — never one person across meetings. A `.txt` and a `.vtt`
with one name are one meeting, and the `.txt` is read. Occurrence IDs derive from timestamp and normalized
topic; these files carry no Zoom occurrence UUID. A `.vtt`'s participants remain unknown: speaker names are
preserved as text, without guessing a person's identity. `zm personal meetings import` names the zone it read the file
times in (`timezone`), and `zm personal meetings import --help` shows it before you run it. Check the imported date, title and transcript
before attaching project or person records.

A file name's time is read in this computer's zone. Set `files.timezone` to the IANA zone the filenames were
created in when it differs, for example `Europe/Madrid`; storage stays UTC. Ambiguous or nonexistent daylight-saving times are refused.
Conflicting contents for the same normalized filename key are an error; correct the conflicting
files before retrying. File discovery fails explicitly on invalid names rather than silently
importing a partial folder.

## Watch for new meetings

For repeated API ingestion, use `zm personal watch api --lookback-days 7 --jsonl`. `zm personal watch files [folder]` watches
a transcript folder, `files.folder` when none is given. With neither, the configured source applies.
API watching accepts `--since-time` and revisits zero through 31 days, and requires online access.
`--since-time` sets the initial lower bound; after a successful cursor write, later cycles use the cursor
with the selected overlap. Failed cycles retain the initial bound until a cursor write succeeds.
The overlap also subtracts from the initial `--since-time` bound.
`--pause` controls the delay between completed cycles. Profile, source and file settings are
captured, along with the OAuth client, before watching begins; changing configuration requires
restarting the watch. Cycles never overlap and close their store connection before emitting a
receipt. Stop with Ctrl-C.

To watch a transcript folder:

```sh
zm personal watch files ./downloaded-transcripts --pause 10s --jsonl
```

Watching rescans the folder for each cycle, so corrected older files are revisited. It imports serially,
closes the cycle's store connection before emitting its receipt and waits for output to drain before
starting another cycle. Intervals range from one second to one day. This is a foreground process;
stop it with Ctrl-C. Headless watching requires `--jsonl`; a stream cannot use `--json`.
Select a local profile before watching, just as for a one-time import.

Cancellation allows up to one second to flush a fully completed receipt if it arrives during
store close. A blocked output pipe stops that flush; no later cycle starts.

## Archive cloud recordings

`zm` archives available cloud recording video, audio, transcripts and chat files. Find an occurrence
and download its available files to an explicit destination:

```sh
zm personal recordings list --since-time 2026-10-01 --until-time 2026-10-10 --json
zm personal recordings show <zoom-occurrence-uuid> --json
zm personal recordings download <zoom-occurrence-uuid> --output-dir ./zoom-archive --json
zm personal recordings archive check ./zoom-archive --offline --json
```

Replace `<zoom-occurrence-uuid>` with an occurrence UUID returned by the recording list, not a
local meeting ID or the numeric Zoom meeting number. The download receipt identifies saved and
unavailable assets. Verification checks the local files against their manifest; it does not prove
Zoom had every expected recording. If there are no recordings, check the date range, host account,
cloud recording availability and scopes before widening the backup. Without `--until-time` the
list ends today in the computer's zone, or in `--timezone`, and `meta.timezone` names that zone.

For recording history across months, use:

```sh
zm personal recordings download --since-time 2026-01-01 --until-time 2026-10-10 --output-dir ./zoom-archive --jsonl
```

A date-range download accepts explicit ordered dates spanning at most ten calendar years. It splits them into monthly
requests, deduplicates occurrence UUIDs and downloads serially. Each JSONL item record describes one
completed occurrence; earlier receipts and completed files remain if a later request fails. Repeat the
same range or an overlapping recent range to discover new assets. With a selected local profile,
the download saves durable progress and retains pending recordings. Use `--recheck-since-time YYYY-MM-DD` to
rediscover recent dates for late or changed assets, and `--checkpoint` to select its checkpoint file.
`--max-pages` and `--max-entries` bound discovery. Use `--jsonl` to stream completed receipts, or `--json` for a bounded list returned after the whole range finishes.
Piped output defaults to JSON. If an aggregate run fails, no partial JSON is printed; completed files and durable
checkpoints remain available for the next attempt. A meeting ID and date-range options cannot be combined;
`--file-ids` applies only to a single meeting.

`recordings sync` has been removed; use `recordings download` with the same date bounds. If a saved
permission names `recordings.sync`, commands stop with migration guidance. Review that entry and replace it
with `recordings.download` in the profile's permission map, preserving all other restrictions. The new entry
applies to both single-meeting and date-range downloads. See [profile permissions](configuration.md#permissions).

Checkpoints acknowledge earlier successful archives; they do not check current disk integrity or
prove that all provider recordings were available. Run `recordings archive check` to check local
files. Use `--no-resume` to rescan the full requested range without durable progress.

Recording lists accept an ordered date range of at most 31 days. Downloads stream to disk rather
than loading a video into memory. The default per-file limit is 20 GiB; change it with `--max-bytes`.
Use `--file-ids` to select comma-separated asset ids. Only completed, downloadable assets are saved;
the receipt reports unavailable assets separately. Zoom permissions, recording retention and account
features determine what can be downloaded. Assets from a meeting you attended are not necessarily
available through your cloud recording API.

Each occurrence has a manifest containing metadata, file sizes and SHA-256 checksums. Signed
download URLs and OAuth tokens are excluded. Repeating a download verifies existing manifest files
and skips matching assets; a file whose size and modification time are unchanged since it was last
verified (`.zoom-verified.json`) is not hashed again. `recordings archive check` always hashes every file. Existing files are never overwritten; a mismatch requires a new destination.
Downloads and syncs act for the profile named first (`zm personal recordings …`); the
archive belongs to its account. Interrupted downloads retain verified partial bytes and resume only
when a strong validator and the returned range agree. Changed representations restart safely.
`--no-resume` uses ephemeral partials. Completed manifest entries remain available if a later transfer fails.

## Locks and recovery

Archive commands inspect and verify local data without logging in or opening a database. Concurrent
writers to the same destination are refused. A download takes over a lock left by a dead process on
this machine by itself. For the rest, inspect `recordings archive locks` and preview
`recordings archive recover`. Add `--yes` to remove recognized locks owned by a dead process
on this machine; active, foreign and unrecognized locks are preserved. Recovery removes stale lock
markers only. Download continuation can recover a completed promotion only when its owned journal,
verified partial and final file all match; unrelated untracked files remain protected.

If archiving reports lost or changed writer ownership, inspect the destination and its lock records
before retrying. Run archive checksum verification for completed files: a cleanup failure can occur
after files were saved, even when no successful download receipt was returned.

## Daily backups

To plan a daily backup, choose an absolute destination and timer timezone:

```sh
zm personal recordings schedule create --name daily --output-dir /home/AliceExample/zoom-archive --since-time 2026-01-01 --at 03:15 --timezone Europe/Madrid --json
zm personal recordings schedule list --offline --json
zm personal recordings schedule run <schedule-id> --jsonl
zm personal recordings schedule disable <schedule-id> --yes --json
```

Creation previews by default. Add `--yes` to install a Linux systemd user timer; `--dry-run`
overrides it. Automatic installation currently supports Linux only. The timer follows its IANA
timezone, while recording discovery uses UTC dates and defaults to seven days of recent rechecks.
Systemd user services must be available for the job to run; previews also work on other platforms.
Jobs capture the local profile, public client ID, destination and runtime/config paths, without
credentials. Running a saved job requires its captured profile and client to remain selected.
Saved status describes the last acknowledged operation; list/show do not query live timer state.
Disabling stops the timer and preserves job definitions and archived files.

## Read and import archived transcripts

Cloud archive assets use hashed filenames and retain their identity in manifests. Read or search
archived transcripts directly:

```sh
zm personal recordings archive transcript ./zoom-archive --offline --json
zm personal search recordings ./zoom-archive "example plan" --limit 100 --offline --json
```

Both commands verify each WebVTT file they read against manifest sizes and SHA-256 digests before
returning parsed cues. Search stops after finding one match beyond its limit; later files remain
unread. They need no login, configuration or database. The transcript read takes `--uuid` or
comma-separated `--file-ids` to select assets, and `--max-bytes` to change the default 8 MiB per-file
read limit; search refuses a transcript over 8 MiB.
Search matches literal cue text after Unicode normalization and lowercasing; speaker names are
not searched. Its default limit is 100, with a maximum of 1000. `has_more` means another matching cue
exists; increase the limit or narrow the query to read more.
Results have no continuation cursor. Finite output remains bounded by `--max-output-bytes`, and a
failed verification emits no successful result.

Use a separate command to import these assets into the selected local profile:

```sh
zm personal recordings archive import ./zoom-archive --offline --jsonl
```

Import verifies every selected VTT asset before opening the store. The default limits are 8 MiB
per file and 64 MiB in total; use `--max-bytes` and `--max-total-bytes` to change them. Select an
occurrence with `--uuid`, or assets with comma-separated `--file-ids`. Each occurrence is appended
atomically by its raw Zoom UUID, preserving other transcripts, summaries, participants and the
pull cursor. Corrected content retains earlier revisions; identical asset hashes are idempotent.
An occurrence with no known start time can receive transcripts only if it already exists. Receipts
report acknowledged or unavailable occurrences. When the exact receipt capability is available,
they also report meeting creation and inserted, replayed and superseded transcript counts from the
same transaction. Older adapters keep the acknowledgement without guessed counts.
Earlier acknowledged occurrences can remain committed if a later append fails.

## Transcribe local audio

Create an independent local transcript from an audio file for an existing stored meeting:

```sh
zm models download parakeet-v3
zm personal meetings transcribe 1 ./AliceExample.m4a --model parakeet-v3 --json
zm personal meetings transcribe 1 ./AliceExample.m4a --model parakeet-v3 --yes --json
```

Preview verifies the input and describes the chosen model without loading it. `--yes` recognizes
with an already installed local model and atomically appends the completed transcript; `--dry-run`
overrides it. Transcription never downloads a model: `zm models list kind:audio` shows the models this version knows,
and `zm models download <model>` fetches one into the folder every WireCat CLI shares, checking each file's
sha256; run it again to repair a model whose files are of another version. A PCM16 WAV, mono or stereo, at 16 or
48 kHz is read as it is; anything else — Zoom's MP4 and M4A recordings, other audio and video — is decoded first by
the `ffmpeg` installed on this computer, into a private temporary folder removed afterwards. The same file always
decodes to the same audio, so transcribing it again is a replay. `--models-dir` selects an absolute installed model
directory. Media, duration, segment count and transcript text have explicit bounds through
`--max-bytes`, `--max-duration`, `--max-segments` and `--max-text-bytes`. Recognition uses fixed
windows of up to 30 seconds, so timestamps describe those windows. Speakers remain unknown. Provider
transcripts and historical revisions are preserved; the applied receipt gives transaction counts and
provenance.

Recognition needs an installed supported speech model; this guide does not assume one is present. A recording
that is not a ready WAV needs `ffmpeg` on `PATH`; zm does not install it. After an applied receipt, open `meetings transcript` and check the words and timestamp
windows before treating the new text as evidence. Continue with [search and citations](search.md).
