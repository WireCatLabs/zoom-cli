# Changelog

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
