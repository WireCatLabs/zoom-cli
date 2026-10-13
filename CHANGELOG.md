# Changelog

## Unreleased

### Changed — may break callers

- **Runs on `@wirecat/cli-core` 0.262.0** (cli-messaging renamed) **and `@wirecat/cli-base` 0.26.0.**
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

### Added

- **`--debug`:** on a failure, the whole log record — cause and stack — after the error object or in place of the
  short line.

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
