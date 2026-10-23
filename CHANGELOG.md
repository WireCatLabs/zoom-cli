# Changelog

## 0.37.0 — 23.10.2026

### Added

- **`zm <profile> review`: the meetings since a point, with what was decided and who talked.** Newest first, the
  last 7 days by default: each meeting's summary and next steps, projects, transcript size and the three longest
  speakers. It says how many meetings have no summary and how many transcripts are nearly empty.
- **Meeting chat is stored at sync, and `zm <profile> mentions list` lists the links in it.** zm reads the chat file
  Zoom saves with a cloud recording (needs `cloud_recording:read:list_recording_files`); the links come most shared
  first, with who shared them and in which meetings.
- **Saved meeting searches: `zm <profile> searches create|run|list|show|delete`.** A query and its options under a
  name, read again at each run, so `date>=7d` in a saved query is always the last week. `searches run` answers as
  `search meetings` does.
- **`search meetings` takes `date:`, `project:`, `tag:` and `topic:` in the query**, as the options of the same name:
  `zm personal search meetings "launch project:RES date>=30d"`.

### Fixed

- **A transcript Zoom has not finished yet is no longer reported as a broken answer.** Sync said "Zoom response is
  missing a required field"; it now says the transcript is not ready, and a later sync reads it. A meeting whose
  transcript Zoom has no data for, deleted or cannot export is stored without one, with no warning.

## 0.36.0 — 22.10.2026

### Changed — may break callers

- **An import or sync that names an unknown profile is refused when other profiles exist.** It made the profile and,
  at a terminal, said so; a typo — `zm persnal meetings import …` — stored meetings under a new name. Now it fails
  with `validation_error` and `details.profiles`, before anything is stored. A new profile starts with
  `zm <name> session start`; on a computer with no profile, the first import still makes one.

### Fixed

- **`models audio download` says how much it will really download.** It printed the whole model's size when only the
  voice-activity file was missing.

## 0.35.0 — 22.10.2026

### Added

- **`zm <profile> stats meetings show|top`: who talks and how much** (cli-core 0.389.0). Talk time, lines and words
  per speaker (the linked person, else the participant, else the transcript's name) and meetings and talk time per
  week, over a date window, a project, a topic or an event. Numbers only; no transcript text is read.
- **Permissions per profile** (WC-PERM-1..3, 9, 10): `zm <profile> config set permissions '{"recordings": "readonly"}'`.
  A key is a command path, dotted; a level is `deny`, `readonly`, `ask` or `allow`, and the most specific key wins.
  `--yes` answers `ask` and never lifts `deny` or `readonly`. Settings, login, help and the MCP server are never gated.
- **`meetings transcribe` takes Zoom's recordings.** A file that is not already a 16 or 48 kHz PCM16 WAV — MP4, M4A,
  other audio and video — is decoded by the installed `ffmpeg` into a private temporary folder first, bit-exact, so
  transcribing it again is a replay. zm does not install ffmpeg.
- **`zm models audio list|download`.** The speech models transcription runs, in the folder every WireCat CLI shares.
  `download` checks every file's sha256, also the voice-activity model, and fetches again what does not match, so it
  repairs a model left by another version.

### Fixed

- **A speech model of the wrong version no longer crashes transcription with "this is a bug".** The engine throws a
  bare number when it cannot read a file; zm now says to run `zm models audio download <model>`, which repairs it.

### Changed — may break callers

- **The profile is the first word: `zm personal meetings list`.** `ZM_PROFILE` names it for a shell session and
  `ZM_PROFILE_LOCK` pins a process to one (another named profile → `permission_error`). The `account.profile`
  setting no longer picks the profile, and `zm config set account.profile` is refused. A command that uses an
  account and names no profile fails with `validation_error`, listing the profiles in `details.profiles` (it was
  `configuration_error`, exit 3). Login, import and sync record a profile; `doctor` lists them (`profiles`, was
  `data_profile`).
- **Each profile has its own Zoom login**, in the keyring as `<client id>:<profile>`. The login saved before this
  version moves to the profile that `account.profile` named, the first time that profile is used.
  `session status` names the `profile`; the verified Zoom user is now `zoom_user`.
- **`context.sources` belongs to the profile named on the command**: `zm research config set context.sources …`.
- **A recording schedule's timer runs `zm <profile> recordings schedule run`.** A timer installed by an earlier
  version names no profile; create the schedule again.
- **Creating, updating or cancelling a Zoom meeting asks first.** At a terminal zm asks y/N; without one and without
  `--yes` the command fails with `confirmation_required` (exit 7). It printed a preview and exited 0; `--dry-run`
  still previews. A profile with `"remote-meetings": "allow"` applies without `--yes`.
- **`zm <profile> mcp` replaces `zm serve --mcp`** (WC-MCP-1..10, WC-CMD-5). One server offers zm's commands as the
  shared three tools `zm_tools_search`, `zm_read`, `zm_write`, and runs each call as the command line does. The eight
  fixed tools and the serve flags (`--meeting-context`, `--meeting-preparation`, `--semantic` and the rest) are gone;
  each tool they added is a command the server offers. The profile's permissions decide what it offers; over MCP a
  change at level `ask` runs without a question, so give an agent's profile `{"remote-meetings": "readonly"}` to keep
  it from changing Zoom meetings. MCP entries change `args` to `["<profile>", "mcp"]`; `zm serve` now says so. The
  library exports `createMeetingMcpServer` and `serveMeetingMcp` are removed.
- **`search meetings --model` ranks words and meaning together** (cli-core 0.385.0 → 0.388.0). It searched by meaning
  alone, ranked each page on its own and ignored the meeting filters. Now the date, meeting, series, event, person,
  project and tag filters apply, one ranking runs across pages, a line found both ways ranks first and is cited by its
  line, and a question — "what did we decide about pricing?" — is searched by its content words, where the word
  search alone refused the «?» and found nothing without it. The answer is a list of hits with `by`, `score` and
  `passage`; it was one item holding `items`. A cursor from an earlier version is refused.

## 0.34.0 — 22.10.2026

### Fixed

- **A store the pre-rename `cli-messaging` wrote is refused again, and left untouched** (cli-core 0.385.0). Since
  cli-core 0.382.0 such a file was opened and failed with `internal_error`; it now fails with `configuration_error`.
- **`zm search meetings` names the zone it read a date in and gives the window in UTC** (cli-core 0.384.0).
  With `--since-time`/`--until-time`, the JSON answer carries `meta.timezone` (the zone a date without its own
  zone was read in) and `meta.window` (`since`/`until` in UTC).

## 0.33.0 — 22.10.2026

### Changed — may break callers

- **cli-core 0.380.0 → 0.382.0.** A file's copy and the API's copy of one meeting become one record when imported
  (the same Zoom meeting ID, starts within 15 minutes); the API's record wins and the file only fills a missing
  transcript. `from:"Name"` finds a speaker known only by name across meetings. Search also matches words speech
  recognition cut off («може» for «может») when they are not dictionary words. The shared store moves to version 28
  when first opened (chat state); older tools still open it.

## 0.32.0 — 22.10.2026

### Added

- **`zm meetings import` reads zoom-searcher's `.txt` transcripts.** `YYYY-MM-DD_HHMM_topic.txt` files with a header
  are imported: the header's title and start replace the file name's, its Zoom meeting ID becomes the series key
  (so the API's copy of the same meeting can join it once cli-core merges them), and its speakers become
  participants of that meeting only. A `.txt` and a `.vtt` with one name are one meeting; the `.txt` is read. A
  `.txt` not named like a transcript is skipped. The import result names the zone file times were read in
  (`timezone`), and `zm meetings import --help` shows the file names and that zone.
- **Meeting search widens garbled words and reads the query language** (cli-core 0.380.0): «риелтор» also finds
  «реелтора»; `OR`, `(groups)`, `-word`, `"phrases"`, `"a b"~N`, `exact:` and `from:"Name"`. See
  [search](docs/search.md).

### Changed — may break callers

- **A search query is now syntax, and a date alone is a local day** (cli-core 0.370.0 → 0.380.0, cli-base 0.49.0).
  `:`, `(`, `"`, `-` and `AND`/`OR`/`NOT` in `zm search meetings` mean query syntax; a query of punctuation alone
  is an error. `--since-time 2026-10-01` starts at local midnight, not UTC midnight; write a time with `Z` for UTC.
  Search cursors from earlier versions are refused; search again.
- **A transcript file name's time is read in this computer's zone unless `files.timezone` is set.** It was read in
  UTC, so a `2026-10-21_1000_…` file from Madrid was stored two hours late. A config that names a zone keeps it;
  saving another setting no longer writes `UTC` into `files_timezone`. Storage stays UTC.
- **A Zoom time with no zone is read in this computer's zone, marked, and named in a warning.** Zoom documents such a
  time as local. It was read in whatever zone the process had, without a word. Now it is read in the computer's IANA
  zone (UTC when daylight saving skips or repeats that hour), the meeting, participant or summary gets
  `metadata.issues: ["time_without_zone"]`, and the command warns once on stderr: "N Zoom times had no zone; read in
  <zone> and marked time_without_zone". A malformed time is still refused. Recording times have no metadata, so
  they are counted in the warning only.
- **`zm recordings list` ends "today" on the local day, not the UTC day.** Without `--until-time` the list ended on
  the UTC date, so in Madrid between midnight and 02:00 it stopped at yesterday. It now takes today in the computer's
  zone, or in the new `--timezone`, and `meta.timezone` names it.
- **Text output that shows a time ends with `times in UTC`.** JSON, JSONL and MCP are unchanged: UTC, ending in `Z`.

### Fixed

- **A `.txt` transcript's time is read as the end of its recording.** zoom-searcher named files and wrote `Дата:`
  from the Zoom portal's "created" time, which is when the recording ended. A `.txt` meeting now starts that time
  less its last line's offset and ends at it, so it lines up with the API's copy of the same meeting.

## 0.31.0 — 20.10.2026

### Added

- **The shared store moves to version 25 when first opened** (cli-core 0.366.0): it adds a history of chat
  changes for the messengers that share it. Nothing is sent.

### Fixed

- **The scenario check catches a step a shell would change** (cli-core 0.348.0 → 0.370.0): `>`, `|`, `;`, `$(`
  or a glob left outside quotes now fails the tests. zm's own steps were already quoted. "Works with" takes memo's
  title from cli-core, the same text every tool shows.

## 0.30.0 — 19.10.2026

### Changed — may break callers

- **`zm session start` works without a terminal, so an agent can pass the login URL on.** It refused when stdin was
  not a terminal, and piped or `--json` login needed `--interactive`. Now it prints `Open this URL to approve Zoom
  login:` and the URL on stderr, even with `--quiet`, and waits for the browser callback; only the paste fallback
  needs a terminal. `--no-input` and CI still refuse it. `--interactive` is removed: it did nothing else.

## 0.29.0 — 19.10.2026

### Changed — may break callers

- **`ZM_READ_ONLY` now works as `TG_READ_ONLY` does in tg, max and wa: reads and mirrors, never changes.** The syncs
  that copy Zoom into the store or an archive run under it — `meetings sync`, `watch`, `recordings sync`,
  `recordings download` and `recordings schedule run`; before, the lock refused them. Changes to Zoom, login,
  configuration and what the owner added (imports, links, transcripts, exports, archive jobs) stay refused with
  exit 5, and the refusal now names which kind it was. The first screen says what the lock blocks.
- **`zm commands` without `--json` prints the commands as text, by section** (Read, Write, Organise, Automate, Set
  up), one line each with `(writes)` on a command that changes something, instead of a JSON array.
  `zm commands --json` is unchanged.
- **Adopt Core 0.348.0 and Base 0.47.0**, which move together: a next step in `--json` output may carry `line`, the
  whole command to type. An SDK consumer that pins Core or Base beside zoom moves with them.

### Security

- **`ZM_READ_ONLY` refuses `zm serve --mcp --semantic --base-url`**, whose semantic queries go to a remote embedding
  service; it ran under the lock in 0.28.0. cli-core's lock refuses a query sent to another service the same way.
  `meetings embeddings` is refused as building vectors, with that reason.

### Fixed

- **`zm meetings list --help` and `zm meetings projects evidence --help` print their help** instead of exiting 2
  (cli-core 0.347.0). A test now runs `--help` on every command.
- **`zm guide --help` returns through zm's own exit handling** instead of ending the process itself.

## 0.28.0 — 18.10.2026

### Added

- **`zm guide [name]`: scenarios, the commands for a common task in order.** Five ship with the package:
  `catch-up`, `find-quote`, `prepare-meeting`, `person-in-meetings` and `archive-recordings`; each prints its goal,
  every step as a command with why, and what to look at. `--json` gives the same as data. Under "Works with" the list
  names memo's `person-brief` for one person across every tool. CI checks that every step's command and options
  parse.
- **Every leaf command's `--help` ends with Returns, Next usually and Example**, and the commands document carries
  the same three lines under each command.
- `zm help options` prints the options for every command; `zm help <command>` prints that command's help.

### Changed — may break callers

- **Adopt Core 0.345.0 and Base 0.46.0.** An SDK consumer that pins Core or Base beside zoom moves with them.
- **`zm --help` and a bare `zm` show a short first screen** instead of commander's full help: what zm is for, what
  it can do that an API client would not, the other WireCat tools, and where to go next (`commands`, `guide`,
  `help options`, `skill show`). It no longer lists every command or global option; `zm --help-all` prints the old
  help. Exit codes are unchanged.
- `meetings list` and `meetings projects evidence` refuse a word that starts with `--` as an unknown option, with
  commander's suggestion, instead of reading it as query text; after `--` every word is query. Known problem: this
  also refuses their `--help` (exit 2); `-h` and `zm help meetings list` show the help.

### Security

- **`ZM_READ_ONLY=1` makes a run change nothing.** Every command that writes to Zoom, the meeting store or a local
  file — `meetings sync`, `import`, `export`, `link`, `update`, `transcribe`, `embeddings`, recordings downloads and
  archive jobs, `watch`, `config set`, `skill install`, `session start` and remote meeting changes — is refused with
  exit 5 before it connects to anything, previews included; so is `search meetings --model`, which builds missing
  vectors. Reads, word search, `batch` and `serve --mcp` still run.
  The lock is judged from each command's declared effects, so a new command that writes is refused too. Before, the
  variable worked only in tg, max and wa.

### Fixed

- `skill install` and `skill show` report a usage mistake, such as `zm skill install --yes`, as the same JSON error
  with exit code 2 as every other command, instead of commander's plain text with exit code 1.
- `session start` with piped or JSON output no longer says "remove --no-input" when that flag was not given. It now
  says to add `--interactive`; with no interactive terminal or under CI it says to run the login in one.
- The installation and sessions guides check `session status` for `state: saved`. They said `logged_in: true`, which
  only `session start` prints.
- `meetings sync` without `zoom.client_id` now says to set the client ID, not to run `session start` first.
- A bad `--pause` (such as `0s`) no longer says "timeout must be"; it says what duration is expected.
- The skill source no longer carries a stale `version`; `skill install` stamps the package version.
- Guides now say that `zm` takes no profile argument, how to remove the login from the keyring, why several Zoom
  users on one machine need separate `ZM_CONFIG_DIR`, and where files go; the Memo examples in the search guide match
  current Memo options; the MCP tool count and optional flags are complete.

## 0.27.1 — 18.10.2026

### Fixed

- `meetings import` and `watch files` report a missing folder as `folder not found: <path>` (exit 6), a file given as the folder as `not a folder`, and an unreadable one as a permission error, instead of "this is a bug".
- A mistyped command, a missing argument or an unknown option now shows what was wrong (`unknown command 'lst'` with the suggestion) instead of "command failed; use --help for usage". Exit code stays 2.
- README: `search recordings <directory> <query>` replaces the removed `search meetings --archive`; the pagination field is `page.next_cursor`; the roadmap link points to this repository.

## 0.27.0 — 18.10.2026

### Changed — may break callers

- Adopt published Core 0.342.0 and Base 0.45.0 as one runtime identity. Base moved its lint, audit and vocabulary
  tables from `@wirecat/cli-base/standards` to `@wirecat/cli-base/standards/tables`; an SDK consumer that imports those
  tables, or pins Core or Base beside zoom, moves to these versions together. Command effects and output are unchanged.

## 0.26.0 — 18.10.2026

### Added

- `meetings scheduled` reads one bounded page of candidate Zoom series with explicit unknown calendar coverage and unverified start hints. `serve --mcp --meeting-inventory` grants the separate read-only `meeting_series_inventory` tool. The selected profile and credential binding are captured before provider reads; neither path opens the meeting store or infers the next occurrence.

### Changed — may break callers

- Adopt published Core0.336.0/Base0.44.2 with one Base runtime identity. Shared read-only mode now refuses additional stored writes; preserve the current command effect and offline metadata when consuming discovery. The registered inventory opt-in remains inactive until a host binds it. Core’s new shared-store migration means read-only preparation needs the current schema; a normal stored read upgrades an older compatible store first.

### Fixed

- Meeting-management guidance connects candidate series discovery with preparation’s occurrence verification, and the app guide names the exact schedule-only permissions.
- Project-scan guidance identifies the parent reference in a search hit’s `meeting` field; a transcript hit’s own `ref` identifies a cue and is not a scan input.

## 0.25.0 — 18.10.2026

### Added

- `meetings projects scan <ref>` suggests existing projects from bounded stored title/transcript evidence. Citations, ambiguity and separate evidence/output coverage remain visible; it opens the selected account read-only and saves no links. MCP exposes `meeting_project_candidates` only with `serve --mcp --meeting-project-candidates`.
- The SDK exports `createZoomSeriesInventoryReader` for one bounded scheduled-meeting page, reusing Core’s account/window-bound discovery contract. It retains past recurring date hints, bounds HTTP bytes before parsing and discards join links; choosing an exact series still requires the existing upcoming proof. CLI/MCP inventory exposure is separate future work.

### Changed — may break callers

- Adopt published Core 0.334.0 and Base 0.44.1 as one compatible runtime identity. Command discovery can include `runnable` for groups and `offline: false` for commands that need network access; strict discovery clients must accept those optional fields. Every executable command declares its effects under the shared standards.

## 0.24.0 — 18.10.2026

### Added

- `meetings prepare` can include cited literal matches from explicitly configured message, mail and document sources. Profile-local selections, captured MCP source IDs, bounded pages and retained coverage keep scope and gaps visible; preparation opens the existing store read-only.

### Changed — may break callers

- Preparation opens an existing compatible shared store read-only and refuses missing or old schemas. Upgrade the shared store through a normal stored-meeting read before retrying. Custom store connectors receive `preparation` intent and optional captured source context; preserve that read-only policy and close the connection on every exit.

### Fixed

- Publishing can wait for the shared writer lock with `WIRECAT_RELEASE_WAIT_SECONDS`; the default still refuses an occupied lock immediately.
- Adopt compatible registry Core 0.332.0 and Base 0.43.2 for shared bounded meeting-context contracts, read-only store opening and registered communications flag roles. Use one shared Base runtime identity. Core’s portable mail bindings keep selected-source preparation working on supported Node 22.16; Zoom explicitly enables the shared communications CLI and MCP capability.

## 0.23.2 — 17.10.2026

### Fixed

- Align the shared runtime with registry Core 0.322.0 and Base 0.40.4, using one runtime Base identity for common validation and output helpers.
- The architecture guide derives the shared vocabulary version from the runtime pin instead of naming an outdated Base version.
- The roadmap points to the delivered reviewed meeting-findings workflow in Memo 0.58.0 instead of listing that shared capability as future work.

## 0.23.1 — 17.10.2026

### Fixed

- Adopt registry Core 0.315.0 and Base 0.40.2, including shared answer redaction and read-only serve protection. pnpm upgrade instructions exempt the tool scope from the minimum release age so an upgrade can install the current release.

- **A sync whose participants call fails keeps the meeting's participant count.** Adopts Core 0.311.0: `meetings sync`
  and `watch` used to overwrite a stored count with nothing when Zoom's participants list could not be read.

## 0.23.0 — 17.10.2026

### Fixed

- Checkpoint leases keep the published `.lock/owner.json` protocol and stale-local recovery so older and newer writers cannot hold the same checkpoint concurrently. Shared atomic checkpoint writes retain the new cleanup and symlink-folder fixes.

### Added

- `meetings prepare --project <name-key-or-alias>` and MCP `project` add cited word matches for one existing project, including unlinked meetings in the selected profile/history window. Up to four bounded name pages retain unconfirmed status, index coverage and continuation; matches never assign project membership.

### Changed — may break callers

- Library hosts upgrading from 0.22.0 supply person lookup methods under `people` when calling `createMeetingContextCapabilities`. This follows the Core store-area adoption introduced in 0.22.1; the command interface and selected-account rules are unchanged.

## 0.22.1 — 17.10.2026

### Fixed

- **An old camelCase config names the key to rename.** Adopts Core 0.307.0: zm now answers
  `clientId is an unknown setting; rename it to client_id (and 3 more problems)` instead of
  `client_id is missing`, which did not say how to fix the file. Still one key, never a value.

## 0.22.0 — 17.10.2026

### Added

- Meeting preparation includes owner notes and annotations attached directly to included earlier
  calls, through Core's shared preparation service. Notes about other accounts or unselected
  meetings cannot enter through a shared project alone.

### Changed — may break callers

- Native preparation notes use selection `owner-written-meeting/person/project-notes` and include
  a nullable `meeting` reference. Older custom store hosts keep their existing selection and shape.

## 0.21.3 — 16.10.2026

### Added

- Adopt registry Core 0.304.0 with Base 0.40.0. Config diagnostics name the first invalid key, a fixed reason and the remaining-problem count without exposing values; meeting sync preserves available parts when another part fails and keeps the cursor for retry.
- **zm starts about a fifth faster after its first run.** It keeps Node's compiled code in a cache, in the
  system's temporary folder (`NODE_COMPILE_CACHE` moves it). Same change as tg 0.62.0, memo 0.52.1 and drive 0.14.1.
- **Token requests record their outcome.** Each login or refresh writes one record to
  `<state dir>/runs/<date>/<run>/events.jsonl`: the HTTP status, whether a new refresh token arrived,
  whether the keyring save worked, a timeout or cancellation, and the process id. No token, hash or
  part of one is written. A command that requests no token leaves no run behind.

### Fixed

- Recording downloads use Core’s shared publication and recovery adapter. Existing Zoom journal and archive formats remain compatible; final files are verified and synced before manifest commitment, and interrupted recovery preserves unrelated files.
- **An invalid config names its file and first bad key.** Every command used to print only
  `zm config is invalid`. The message now names the file and the first key that failed, such as
  `client_id` for an old camelCase file, and never the value. `doctor` still answers, reporting the
  problem under `config.error`; `config show` fails with the same message.
- **`meetings sync` keeps scheduled meetings.** It looked up the instances of recurring meetings
  only, so a scheduled meeting was saved under its listing id, and its participants, transcript and
  summary were not found. Every listed meeting now resolves through Zoom's past instances, with the
  instance's real start time. A meeting Zoom no longer has instances for is skipped, and the sync goes on.
  This adds one request per listed meeting and needs `meeting:read:list_past_instances` for all of them.
- **`bin/release` restarts itself once when the release brings a newer `bin/release`**: folding the changelog
  fast-forwards `main`, and the shell went on reading the old script from the byte it had reached, so the rest of the
  run was a mix of old and new text. It now starts the new script over; a second change during that run stops it
  with `run it again`. Only the repository's own release is affected; the published package does not change.

## 0.21.2 — 16.10.2026

### Added

- Adopt Core 0.299.0 and Base 0.40.0 in one shared Base identity. Command discovery declares
  watch/MCP as persistent and login as interactive; deadlines read this shared metadata while
  retaining the existing bounded-command defaults and explicit timeout override.

### Fixed

- Recording partial files use Core's shared native persistence adapter while retaining existing
  names, checkpoint bytes, resume defaults and Zoom cancellation errors. A final-sync cancellation
  cannot return a completion receipt. Other meeting providers can use the same adapter.
- Agent archive guidance now describes verified range resume and safe restart accurately.
- **Release scripts report observed lock holders separately from stale release labels.** Shared
  diagnostics no longer attribute a live lock to a previous run; wait for the holders to finish, then
  retry.

## 0.21.1 — 16.10.2026

### Fixed

- The publishing workflow checks the exact commit supplied by `bin/release` before building,
  so a concurrent merge cannot silently replace the source selected for release.
- Recording archives use Core's shared native writer leases while keeping the existing marker
  layout and inspect/recover commands. Acquisition refuses a missing or replaced ownership marker
  before downloading, and owned release completes after cancellation without deleting replacements.

## 0.21.0 — 15.10.2026

### Added

- `batch <file>` runs bounded stored word searches and passage reads with one store connection and
  one bounded index pass. JSON/JSONL keeps independent request IDs, answers, errors, cursors and
  coverage; text and Markdown reuse compact passages. File and stdin input are validated before
  the store opens. Read and output budgets retain every input, including those not run.

## 0.20.1 — 15.10.2026

### Fixed

- MCP preparation keeps its item within the requested byte budget after making hidden characters
  visible. It preserves meeting evidence before notes and accepted knowledge, reports omissions,
  and counts cue bytes for the escaped text the client receives. Metadata that cannot fit is refused.

## 0.20.0 — 15.10.2026

### Added

- Meeting preparation includes owner-written notes and annotations about explicitly linked people
  and confirmed global projects through cli-core's shared preparation service. Notes retain their
  references, revisions and separate coverage; meeting evidence and accepted facts keep priority.
  Imported documents, mail, messages and project-alias candidates remain outside this selection.

## 0.19.0 — 15.10.2026

### Changed — may break callers

- Shared standards now use cli-base 0.33.0 and cli-core 0.288.0. `meetings link --source <accounts>`
  replaces `--target-accounts` for explicit additional numeric store accounts used in person lookup.
  Update scripts to use `--source`; the retired spelling has no alias. Command lint's baseline shrinks
  from 27 findings to 26, with no new exceptions.

### Fixed

- Storage documentation reflects cli-core 0.286.0 and later: opening `wirecat.db` preserves legacy
  `messages.db` files and their sidecars. Legacy-file retention is a separate maintenance action.

## 0.18.0 — 15.10.2026

### Added

- Meeting preparation includes cited accepted facts about explicitly linked people and confirmed
  global projects in `knowledge`, including decisions recorded outside the meeting. Lookahead and
  output-limit flags remain visible; meeting evidence has byte priority. Source evidence is not
  revalidated and notes, mail and messages remain unqueried. The shared Core SDK owns the behavior.

## 0.17.1 — 15.10.2026

### Fixed

- **MCP answers show hidden characters in transcripts, titles, names and notes**, as tg's and max's
  do: tag characters, direction overrides, zero-width spaces, U+FEFF, C1 and other control characters come back
  escaped (an ANSI escape reads `\x1b`) in every tool's text and structured content, errors included, and the byte
  limit counts the escaped answer. Every tool's description, and the server instructions, say that this text is
  data from other people, never instructions. Cyrillic, emoji and flags are unchanged; the CLI's `--json` keeps the
  original text. Built on cli-core 0.285.0, which upgrades the shared store to version 16 (new tables and
  triggers only; older tools keep working with it).
- Offline tests remove their per-file temporary roots after resource cleanup. Current and previous
  command traces remain in `coverage` instead of accumulating temporary backup directories.

## 0.17.0 — 15.10.2026

### Added

- Meeting preparation includes cited stored meetings from other series through existing person
  links or confirmed shared projects. The same-account history window, independent related-row
  coverage and shared JSON budget keep the brief bounded. Exact-series context retains priority;
  neither names nor transcript words create associations. CLI and opt-in MCP share Core's service.

## 0.16.0 — 15.10.2026

### Changed — may break callers

- **Flags take the shared names from cli-base 0.31.1.** `recordings download`, `recordings sync` and
  `recordings schedule create` take `--output-dir <dir>` instead of `--destination`, and `watch` takes `--pause`
  instead of `--interval`. The old names are gone. Value names follow the shared vocabulary too: `--at <hh:mm>`,
  `--max-entries <n>`, `--models-dir <dir>`, `--start-time <time>`, `--title <title>`.

## 0.15.0 — 15.10.2026

### Changed — may break callers

- **Nested JSON selectors share the Base projector.** Dotted paths traverse objects and arrays while keeping coverage, pagination and execution metadata. Meeting search hits include stored title, date and source reference/link, so agents can cite hits without separate detail reads. Compact passage selection and the bundled skill use the same rules.
- **Config files use snake_case without automatic rewriting, and startup no longer moves folders.** Rename older config fields and explicitly choose the current folders before upgrading. The `zoom.clientId` command alias still writes `client_id`.

## 0.14.0 — 15.10.2026

### Changed — may break callers

- **`recordings download` and `recordings sync` need a selected profile.** The archive belongs to the profile's
  account; without `account.profile` they fail with `configuration_error` instead of using an unnamed account.
  The SDK's `DownloadOptions.account` is required, and `syncRecordingArchive` takes a service with `catalog`.

- **`ZoomError` is gone from the SDK**; failures are cli-base `CliError`s. `StoreConnection` capabilities are
  required, `StoreConnectRequest.capability` and `StoreConnection.appendTranscripts` are gone, and
  `ProgramDeps` no longer takes capability overrides; `createStoreConnector` takes a full cli-core store.

- **A terminal prints the answer's items, not the whole envelope**, with next steps on stderr — cli-core's shared
  renderer. JSON and JSONL output keep their shape.

- **`--json=id,title` replaces `--fields`** (the standard's `--json [fields]`, read as tg, max, drive and memo read it
  through cli-core's shared `liftJson`). `--fields` is gone, and fields come only with `--json`, not `--jsonl`. A
  field the answer does not declare is refused with the fields it has. Adopts cli-core 0.280.0.

- **`zm search recordings <directory> <query>` replaces `zm search meetings <query> --archive <directory>`.** One
  command answered with two shapes; archive search now has its own command and answers with `search all`'s hits
  (`ref` `recording:<file id>/<cue position>`, `title`, `timestamp`, `excerpt`, `sender_name`, `offset_ms`; `account`
  is the archive folder) instead of raw cues, so `--json=ref,excerpt` works. `--archive`, `--uuid`, `--file-ids` and
  `--max-bytes` are gone from `search meetings`; the new command takes only `--limit`. To read one occurrence or
  file, or a transcript over 8 MiB, use `recordings archive transcript`.

- **Settings are named in snake_case.** The config file stores `client_id`, `files_folder`, `files_timezone` and
  `account_profile`, and `zm config set zoom.client_id` is the documented name. The camelCase spellings are still read
  in the file and accepted by `zm config set zoom.clientId`; an old file is rewritten in snake_case on the next read,
  keeping its mode. A file giving both spellings of one setting with different values is refused.

### Added

- **Prepare one selected upcoming series with `meetings prepare <series-id>`.** Read Zoom occurrence
  proof alongside bounded stored transcripts, observed people, confirmed projects, accepted meeting
  facts and directly sourced tasks. Citations and coverage stay together; no findings are accepted.
  `serve --mcp --meeting-preparation` enables the matching optional `meeting_prepare` tool.

- **The SDK can read explicit upcoming occurrence proof through `createZoomUpcomingMeetingReader`.**
  Zoom translates bounded meeting details into the shared reader, keeping missing schedules and
  incomplete recurrence coverage unverified. The shared preparation workflow uses this library capability.

### Fixed

- **Remote meeting ids reject trailing line breaks before authentication.** URL normalization no longer silently accepts malformed identifiers.
- **A download takes over a lock left by a dead process on this machine**, so a crash no longer blocks the next
  run until `recordings archive recover --yes`. Active, foreign and unrecognized locks still refuse.
- **A rerun no longer hashes every archived file.** A file whose size and modification time match what was last
  verified (kept in `.zoom-verified.json`) is trusted; any change rehashes it. `recordings archive check` still
  hashes everything.

## 0.13.0 — 14.10.2026

### Changed — may break callers

- Adopt cli-base 0.28 and Core 0.273’s shared answer policy. Discovery uses contract 3 with separate
  local and remote effects. JSON lists include a page mode and `next_cursor`; JSONL emits typed
  item records and an end record, including for empty results. Scripts reading the former whole
  answer per line must read `data` and the final page/completeness instead.
- Successful CLI/MCP answers include complete metadata. Skipped search sources report partial
  completeness and source issues. Shared policies validate mounted next steps and retry safety.

## 0.12.0 — 14.10.2026

### Added

- Existing-project name/key/alias evidence through shared `meetings projects evidence` and MCP `meeting_project_evidence`. Reads preserve citations, account-bound/frozen continuation and explicit unknown coverage without refreshing indexes or accepting membership.

### Fixed

- Search/MCP guides locate report continuation under `item` and omit the removed word-search selection field.

## 0.11.0 — 14.10.2026

### Changed — may break callers

- Uses shared SDK `@wirecat/cli-core` 0.268.0. Command discovery declares contract 2. Successful CLI/MCP replies use snake_case item/list envelopes with execution metadata; JSONL retains complete packets. Detailed reports and streaming acknowledgements are under `item`.
- Meeting details use `item` and count current transcripts; transcript/summary reads use `items`. Word hits carry cited `ref`, `meeting`, `excerpt` and `offset_ms`, with standard scoped continuation.

### Fixed

- MCP rejects unknown/invalid arguments in its handler, names the field before opening a store, declares strict success/error schemas and preserves shared error reasons/details.
- The Zoom app guide starts with links to using an existing app or creating your own.
- Installation now offers agent-assisted setup, existing/new Zoom app paths, Windows command launchers and a first cited transcript check. The entry page identifies itself as the starting point.

## 0.10.0 — 14.10.2026

### Changed — may break callers

- Uses shared meeting SDK `@wirecat/cli-core` 0.267.0 and framework `@wirecat/cli-base` 0.27.2.
- Stored meeting lists filter with a metadata query in place of list-only `--since-time` and `--until-time` flags. Answers use the shared meeting entity with string IDs and provider/account references, `page` and continuation steps. JSONL preserves the full list envelope.
- Participant discovery returns bounded snake_case observations with `identity_id`, page-local ambiguity and explicit read coverage. JSONL preserves continuation instead of streaming observations alone. Follow `page.next` or `page.cursor` even after an empty scan page.

### Added

- `meetings people` and MCP `meeting_people` bound matching observations, inspected observations and stored name/email bytes with `--limit`, `--scan-limit`, `--max-read-bytes` and `--cursor` (snake_case MCP arguments). Cursors retain the selected account and name query; no automatic person links are inferred.

### Fixed

- Existing links to first-sync setup, stored meeting search and explicit vector preparation keep working after the command renames.

## 0.9.0 — 14.10.2026

### Changed — may break callers

- **Runs on `@wirecat/cli-core` 0.264.0** (cli-messaging renamed) **and `@wirecat/cli-base` 0.27.1.**
- **Every key zm writes itself is snake_case**, on stdout and in its own MCP results: `config show`
  (`account_profile`, `client_id`, `files_folder`, `files_timezone`), `doctor` and `session status`
  (`data_profile`, `expires_at`), `session start` (`logged_in`), recordings, archives and schedules (`manifest_path`, `timer_state`,
  `checkpoint_revision`, `job.capture.client_id`), `meetings update|link|transcribe|evidence|context`,
  `search meetings`, `search all` and `watch` (`has_more`, `next_cursor`, `meeting_id`, `transcript_rows`). `--fields`
  takes the snake_case names. `commands --json` has `global_options`, `inherited_options` and `exit_codes`, and its
  `contract` is 1. The meeting commands that come from cli-core (`meetings list|show|transcript|summary|export|people`)
  keep their keys until cli-core changes them.
- **`search all --meeting-cursor` and MCP `search_all` `meeting_cursor` take the snake_case cursor** that
  `meetings.next_cursor` prints (`account_id`, `query`, `meeting_offset`, `hit_offset`).
- **A failure reads as one line at a terminal** (`✗ message`), and as the JSON error object when output is piped or
  `--json`/`--jsonl` is set. A crash in start-up is `internal_error` (exit 1), not `configuration_error`.
- **What `watch` reads is its first argument, not `--source`:** `zm watch api` and `zm watch files [folder]`.
  With neither, the configured `source` applies. A bare folder (`zm watch ./downloads`) is now an error; write
  `zm watch files ./downloads`.

### Added

- Open a transcript search hit with `meetings passage <ref>` to read cited surrounding lines as text, Markdown or JSON. `--before-n`, `--after-n`, byte budgets and explicit coverage keep the result bounded; retained revisions and optional fingerprint checks preserve the source. MCP adds the same account-bound `meeting_passage` tool with `--meeting-context`.

- **`--debug`:** on a failure, the whole log record — cause and stack — after the error object or in place of the
  short line.

### Fixed

- README setup now distinguishes Public Client ID from Client Secret, makes manual scopes and optional manifest setup explicit, and uses the current login command and published portal address. Coverage claims distinguish available stored data from separately archived transcripts.

- The security guide explains automatic search indexing and generation of missing semantic vectors, including transcript delivery to an explicitly selected remote endpoint.

- The MCP guide lists the seven default tools after search consolidation; the meeting-management guide makes clear that its listing scope must be added manually.

- The search guide distinguishes CLI generation of missing semantic vectors from MCP reads of existing vectors, and the guides use `session start` for browser login and `--cursor` for evidence continuation.

- **`zm meetings import <folder>` and the files source read a folder one transcript at a time.** It opened every
  `.vtt` at once. A transcript over 10 MiB, the cap zm already puts on a transcript download, is now refused before it is read.
  A folder of more than 10,000 transcripts is refused with an error asking you to move some into another folder.

## 0.8.0 — 13.10.2026

### Changed — may break callers

- **Runs on `@wirecat/cli-messaging` 0.258.0 and `@wirecat/cli-base` 0.24.0.**
- **The shared store and models move to the WireCat folder** (`~/.local/share/WireCat/` on Linux and macOS,
  `%LOCALAPPDATA%\WireCat\Data\` on Windows) on the first start of zm, as tg, max and memo do. Nothing moves when
  `MESSAGING_STORE` or `WIRECAT_STATE_DIR` is set. Two different stores under the same name stop the command with
  an error naming both paths; nothing is changed.
- **Meeting ingestion moves under `meetings`.** The old names stop working:
  - `zm pull` → `zm meetings sync`, with `--since` → `--since-time`
  - `zm import <folder>` → `zm meetings import <folder>`
  - `meetings list --since`/`--until` → `--since-time`/`--until-time`
- **One error object:** `{ error: { code, reason, message, … } }` on stderr and in MCP results. A failure that is
  not a typed error is `internal_error` (exit 1) and replaces `generic_failure`, also in `commands --json`
  `exitCodes`.
- **`zm commands --json` prints the shared commands document**: `cli`, `version`, `contract`, `description`,
  `globalOptions` (was `options`), `commands` and `exitCodes`; a command path adds `scope` and `inheritedOptions`.
- `zm commands` without `--json` lists one row per command: usage, description and whether it writes.
- **Commands renamed to the shared command words.** The old names stop working:
  - `zm login` → `zm session start`
  - `meetings link-person` → `meetings link`; `meetings link-event` → `meetings update`
  - `recordings archive inspect` → `recordings archive show`; `recordings archive verify` → `recordings archive check`
- **Options renamed.** The old names stop working:
  - `recordings list|sync --from`/`--to` → `--since-time`/`--until-time`; `recordings sync --recheck-from` →
    `--recheck-since-time`; `recordings schedule create --from` → `--since-time`
  - `watch --since` and `meetings context --since` → `--since-time`
  - `meetings evidence --after` → `--cursor`
  - `meetings task-proposal --kind` → `--type`
  - `remote-meetings create|update --topic` → `--title`
- **One meeting search, `zm search meetings <query>`, that indexes on its own.** It replaces four commands, which
  stop working:
  - `meetings search` and `meetings search-page`: their filters all move over, including `--event-id` and
    `--series-id`; `--since`/`--until` are `--since-time`/`--until-time` and `--after` is `--cursor`.
  - `meetings search-index`: gone. The search indexes what was stored since the last search before it reads.
  - `meetings semantic`: `search meetings <query> --model <model>` (with `--base-url`, `--dims`,
    `--max-chunks`, `--max-rows`, `--max-text-bytes`; `--after-chunk-id` is `--cursor`). It first builds the
    vectors that are missing for that model.
  - `recordings archive search <directory> <query>`: `search meetings <query> --archive <directory>` (with
    `--uuid`, `--file-ids`, `--max-bytes`).
  - MCP: `meetings_search`, `meeting_search_page` and `meeting_semantic_search` are one tool,
    `search_meetings`. With `serve --semantic`, `by_meaning: true` ranks existing vectors; MCP never builds
    them.
- Value names in help now say what they hold: `--limit <n>`, `--model <model>`, `--max-read-bytes <bytes>`,
  `--max-text-bytes <bytes>`; every argument has a description and long summaries are shorter.

## 0.7.3 — 12.10.2026

### Added

- `meetings search-page` combines dates with `--identity-id`, `--person-id`, `--project`, `--tag` or `--topic`. Project names, keys and explicit aliases resolve through the shared vocabulary; projects require confirmed membership and labels require explicit meeting tags. Participant filters select meetings rather than attributing speech.
- Read-only MCP `meeting_search_page` offers the same bounded search in the server-selected account.

### Fixed

- Meeting search no longer duplicates common command registration and validation in Zoom: cli-messaging owns these plus canonical selection and MCP handling for reuse by other providers.
- Vitest resolves the published cli-base compiler config directly for Oxc; TypeScript continues to check the full project configuration.

## 0.7.2 — 12.10.2026

### Fixed

- **Built on the shared framework under its new name, `@wirecat/cli-base` 0.21.0**, with `@wirecat/cli-messaging`
  0.253.0. The framework was renamed from `@wirecat/cli-core`; an install now holds one copy of it. Nothing
  changes in the `zm` commands.

- Complete app setup and existing-app reuse instructions, browser callback recovery and first-result checks; correct the starter manifest scope claims and clarify data and account boundaries across the guides.

- Meeting notes and facts examples now use Memo’s supported commands, including account-scoped
  note creation. The public roadmap separates available workflows from planned meeting intake
  and preparation. Zoom app setup uses one replaceable client-ID placeholder.

## 0.7.1 — 11.10.2026

### Fixed

- Reuse shared native file-safety and bounded WAV helpers from `cli-messaging` instead of
  maintaining provider-local copies. Archive verification and local transcription keep their
  existing limits and preview behavior.

## 0.7.0 — 11.10.2026

### Changed — may break callers

- **Built on `@wirecat/cli-messaging` 0.246.0, which now contains the meetings code.** zm imports
  `@wirecat/cli-messaging/meetings` and no longer depends on `@wirecat/cli-meetings`; commands and data are
  unchanged. A script that imported `@wirecat/cli-meetings` from zm's install folder imports
  `@wirecat/cli-messaging/meetings` instead.

### Added

- **A front-page README** introduces `zm` as Zoom context for AI agents: quick start, scenarios and
  an honest list of what is not ready come first, then a reference by task with links to new `docs/`
  pages for installation, sessions, usage, the archive, search, topic search, MCP, remote meetings,
  configuration, troubleshooting and security, listed in `docs/meta.json`.

## 0.6.0 — 11.10.2026

### Changed — may break callers

- **On macOS zm keeps its files where it does on Linux**: `~/.config/zm`, `~/.local/share/zm` and `~/.cache/zm`
  instead of `~/Library/…`. The first run moves the old folders there and copies the saved login to the keyring
  name of the new config folder, so no new `zm login` is needed. If the move cannot happen it prints one warning
  and uses the old folders for that run. Linux and Windows are unchanged. Built on `@wirecat/cli-messaging` 0.241.0 and
  `@wirecat/cli-meetings` 0.4.2, which npm installs side by side with cli-core 0.20.0.

## 0.5.1 — 11.10.2026

### Fixed

- **Shared facts compatibility** pins the published producer 0.237.0, supplies its required facts
  port to meeting context services, and retains scoped event/person links after the facts migration.
  The update includes the producer's meeting-account purge and attachment-piece fixes.

## 0.5.0 — 11.10.2026

### Added

- **Explicit meeting links** preview or apply event and participant/person associations in the
  shared store. Writes check live account ownership and optional prior values, keep manual identity
  audit and involvement records current, and support deliberate target-account selection.
- **Bounded word search and indexing** page hits inside a large meeting and match literal prefixes
  or configured English/Spanish/Russian word forms. Explicit indexing processes small local batches;
  read coverage reports pending work and unknown completeness.
- **Local WAV transcription** previews media without recognition and uses an already installed
  shared speech model only with explicit `--yes`. PCM16 mono/stereo WAV at 16 or 48 kHz is processed
  in bounded windows, with coarse timestamps and separate media/model provenance. Provider
  transcripts remain intact; reruns retain local history. No model download or large dependency is added.
- **Exact archive import receipts** report transactional created, inserted, replayed and superseded
  counts on the current shared store. Committed receipts survive late cancellation; malformed
  acknowledgements preserve uncertain outcomes and never trigger a second write.
- **Memo integration guidance** uses the existing meeting notes, tags and memory commands and shared
  records, without adding duplicate Zoom knowledge commands.

## 0.4.0 — 11.10.2026

### Added

- **Profile-bound recording resume** retains independently verified partial bytes and resumes only
  with matching strong validators and response ranges. Owned promotion journals recover the gap
  between final publication and manifest commitment without adopting unrelated files.
- **Durable archive progress** saves lease-protected checkpoints, retains unavailable assets for
  retry and supports recent discovery rechecks plus bounded pages/entries. Prior acknowledgements
  do not certify current disk integrity or complete provider availability.
- **Daily archive jobs** preview captured profile/client/destination/runtime settings and install
  Linux systemd user timers only with explicit `--yes`. Jobs use durable sync and recent rechecks;
  changed profile/client configuration fails before credentials. Other platforms support planning
  and manual runs. Disabling preserves job definitions and archived files.
- **Provider-neutral SDK reuse** moves management validation, transfer rules, catalog sync and
  schedule planning into cli-meetings 0.3.0. Public Zoom adapters expose optional shared capabilities;
  authentication, URL trust and native storage remain in this package.

### Changed — may break callers

- Configured local profiles enable persistent resume by default. Explicit `--resume` requires a
  profile; `--no-resume` and legacy unscoped calls retain ephemeral transfer behavior.

## 0.3.2 — 11.10.2026

### Fixed

- Explicit shared mail search finds email stored in dedicated mail tables alongside older imports,
  without duplicate email locators. Mail reads include stored email accounts; message reads use
  the selected local account.

## 0.3.1 — 11.10.2026

### Fixed

- Package references, documentation and fixtures use the WireCat namespace throughout.

## 0.3.0 — 11.10.2026

### Changed — may break callers

- **Shared store security policy** deletes legacy unencrypted `messages.db` and its SQLite sidecars
  on default-path store open, without migration. Explicit paths and `MESSAGING_STORE` preserve the
  files; an active legacy lock defers deletion until a later default-path open.

### Fixed

- **Offline remote-model checks** refuse remote semantic requests before store or model work.
- **MCP profile selection** stays fixed after its first tool read, including across config edits.
- **Acknowledged embedding receipts** survive late cancellation within a bounded output grace period.
- **Archive file replacement checks** verify the opened object and path before reading bytes,
  including on Windows where no-follow file-open flags are unavailable.

### Added

- **Archive transcript import** verifies every selected VTT before opening the store, then appends
  atomically by occurrence UUID. It retains corrections and unrelated meeting data, preserves the
  pull cursor, and emits per-occurrence acknowledgements without inventing replay counts.
- **Bounded evidence, person context and task proposals** use public producer services, selected
  account ownership and durable revision/cue references. Proposals never create tasks.
- **Shared resource search** defaults to meetings, with explicit broader resource selection,
  bounded candidate scans and reports that preserve skips, coverage and continuation cursors.
- **Explicit meeting vectors** preview generation by default; `--yes` rebuilds and embeds one
  bounded current-revision batch. Installed local models or explicit remote endpoints are required.
  Read-only semantic queries rank scanned existing candidates and expose their coverage limits.
- **Optional read-only MCP tools** add context, meetings-only unified search and fixed-model
  semantic queries. Embedding generation and task creation remain outside MCP.
- **Generated command reference and measured test matrix** reuse cli-core's generators. Release
  and manual validation install the checked tarball on Linux and Windows with Node 22.16 and 24.

## 0.2.2 — 10.10.2026

### Fixed

- **One shared meeting model** aligns cli-messaging 0.219.0 with cli-meetings 0.2.4, so the Zoom
  commands and native meeting adapter resolve the same package version.

### Changed — may break callers

- **Shared store baseline** adopts automatic log pruning, checked at most daily on store open or
  log writes: agent audit records older than 90 days are removed, and handled bot-update payloads
  older than 30 days are cleared while their delivery rows remain.

## 0.2.1 — 10.10.2026

### Added

- **Offline archive transcript reads and search** verify manifest size and SHA-256 before parsing
  WebVTT. Select occurrences or files, bound per-file reads and results, and search literal cue text
  without login or a meeting database. Successful finite output is withheld if verification fails.
- **API foreground watching** repeatedly pulls the configured source with an optional late-part
  lookback. File watching retains its positional folder form. Configuration is captured before the
  first cycle; cycles serialize ingestion and close each store connection before emitting a receipt.

## 0.2.0 — 10.10.2026

### Added

- **Persistent meeting data** connects the published shared SQLite adapter lazily. Imports and pulls
  register the selected local profile; reads resolve it without registration. Summary/history reads,
  Markdown/VTT exports, folder watching and MCP now use real persistence in the executable.
- **Recording history synchronization** splits explicit date ranges into monthly requests and emits
  serial occurrence receipts with verified skipping. Folder watching rescans corrected transcripts
  and closes each ingestion connection before its receipt; headless streams require JSONL.
- **Read-only MCP serving and packaged agent instructions** reuse the shared meeting tools and
  cli-core skill installation. MCP reads use the selected account and close before responding;
  discovery opens no database. Native reads require a selected profile with stored meeting data.
- **Cloud recording archives** discover assets and stream available video, audio, VTT and chat files
  into a local archive with checksummed manifests, verified skipping, bounded transfers and explicit
  stale lock recovery. Archive inspection and verification do not need Zoom or a meeting database.
- **Simple remote meeting commands** list, show and retrieve invitations, and preview creation,
  updates and cancellation. `--yes` applies once; `--dry-run` always previews. Dispatched writes with
  an uncertain result are reported separately and never automatically retried.
- **Command discovery and local diagnostics** expose command metadata/examples, shell completion,
  local runtime/config checks and saved OAuth session status without opening the meeting database.
  Session status distinguishes OAuth login from the selected local data profile.

### Changed — may break callers

- **Native store runtime prerequisites** add the published cli-messaging 0.218.0 dependency.
  Node now requires 22.16 or newer within 22.x, or version 24 or newer, matching its SQLite runtime.
- **Shared CLI output and errors** use cli-core rendering and exit codes. Piped output is JSON;
  terminal output uses human-readable rendering. `--quiet` suppresses non-error diagnostics.
- **Unattended login fails promptly.** CI and terminals without interactive input cannot launch a browser;
  Piped or JSON login with an input terminal requires `--interactive`.

### Fixed

- **Cancellation and output cleanup** close file handles when cancellation arrives during open,
  wait for submitted writes and drain, and preserve completed stream receipts with a bounded grace.
  Failed close or file output never emits a successful result; existing exports are never overwritten.
- **OAuth grants remain bound to their client.** Configuration changes cannot save tokens under a
  different client key. Successful malformed or interrupted grants report an uncertain outcome and
  require login before retrying.

### Security

- Fast secret checks remain on PRs; source, production dependency and workflow security checks run before publication. Automatic Socket checks are disabled.

## 0.1.1 — 10.10.2026

### Added

- **Local account profiles and lazy connections** let library callers select a stored account, open
  only for store commands and close after success or failure. The standalone SQLite binding remains
  pending the shared store release.
- **Bounded late-transcript recovery** exposes `pull --lookback-days` from zero through 31 days.
  Zoom uses the shared cli-meetings 0.2.3 package.

## 0.1.0 — 10.10.2026

### Added

- **`zm login`** uses public-client PKCE through the browser callback, validates state, accepts
  pasted callback parameters, and saves tokens in the system keyring. Refresh uses the client id
  without a secret; actual token scopes are retained.
- **The API source** reads occurrences, participants, transcripts and summaries. Rejoin sessions
  are grouped by stable participant identity; missing scopes are named without exposing response
  values in errors.
- **The files source and commands** import legacy WebVTT filenames and expose shared meeting reads.
  Import and pull use the memory store in tests; real ingestion awaits the shared SQLite adapter.
- **Installed-package acceptance checks** exercise the real bin with isolated config and guards
  against network, browser and keyring access. A CI release workflow builds and packs before a
  separate trusted-publishing job; tagging follows registry verification.

### Fixed

- **File occurrence ids** use the original filename date, clock and topic, so correcting the
  configured timezone updates the existing meeting instead of creating a duplicate.
- **OAuth and CLI recovery** fail promptly when a browser cannot launch without paste input;
  help and version work with malformed config. Token transport and malformed-response errors are
  classified without exposing arbitrary response text. CLI version follows package metadata.
- **Source fidelity** validates every transcript redirect and bounds downloads, deduplicates stable
  participant sessions, preserves empty unified summaries and rejects invalid timezones and
  conflicting normalized filenames. Import preflights the whole input before saving; identical
  filename aliases import once.

### Changed — may break callers

- **The project is now licensed under Apache License 2.0.** See `LICENSE` for the terms.
