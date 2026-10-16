# Changelog

## Unreleased

### Added

- Adopt registry Core 0.304.0 with Base 0.40.0. Config diagnostics name the first invalid key, a fixed reason and the remaining-problem count without exposing values; meeting sync preserves available parts when another part fails and keeps the cursor for retry.
- **zm starts about a fifth faster after its first run.** It keeps Node's compiled code in a cache, in the
  system's temporary folder (`NODE_COMPILE_CACHE` moves it). Same change as tg 0.62.0, memo 0.52.1 and drive 0.14.1.
- **Token requests record their outcome.** Each login or refresh writes one record to
  `<state dir>/runs/<date>/<run>/events.jsonl`: the HTTP status, whether a new refresh token arrived,
  whether the keyring save worked, a timeout or cancellation, and the process id. No token, hash or
  part of one is written. A command that requests no token leaves no run behind.

### Fixed

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
