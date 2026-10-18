# Architecture

`@wirecat/cli-base` supplies configuration paths, secure config writes and the keyring seam.
`@wirecat/cli-core/meetings` supplies the domain model, source/store ports, ingestion, management,
recording transfer, archive synchronization, schedule planning and commands.
This package contains Zoom-specific login and sources; it contains no SQL.

| Module | Responsibility |
|---|---|
| [tokens.ts](../../src/tokens.ts) | keyring-only token storage, public-client exchange and refresh, outcome records without token material |
| [run-log.ts](../../src/run-log.ts) | a cli-core run under `<state>/runs`, opened on its first record |
| [login.ts](../../src/login.ts) | PKCE, loopback callback, paste fallback and listener cleanup |
| [api.ts](../../src/api.ts) | pagination, occurrence UUIDs, participant sessions and downloads |
| [files.ts](../../src/files.ts) | file contents, legacy names and source metadata |
| [config.ts](../../src/config.ts) | public client and file-source settings |
| [program.ts](../../src/program.ts) | the command tree, output, per-run state and the injected store dependency |
| [setup-commands.ts](../../src/setup-commands.ts) | `config`, doctor, session status and browser login |
| [store-commands.ts](../../src/store-commands.ts) | Zoom's commands over the shared store, each opening it only when its action runs |
| [meeting-source.ts](../../src/meeting-source.ts) | the API or folder source the config names, built on first use |
| [recording-schedule-setup.ts](../../src/recording-schedule-setup.ts) | saved schedule jobs, Linux user timers and per-job credentials |
| [meeting-commands.ts](../../src/meeting-commands.ts) | Core's stored-meeting commands, with the effects Core leaves undeclared |
| [meeting-project-evidence-commands.ts](../../src/meeting-project-evidence-commands.ts), [meeting-project-evidence-mcp.ts](../../src/meeting-project-evidence-mcp.ts) | thin account/resource bindings over Core project discovery and registered schemas |
| [meeting-preparation.ts](../../src/meeting-preparation.ts), [meeting-preparation-mcp.ts](../../src/meeting-preparation-mcp.ts) | per-call account/credential binding and close-before-output over Core preparation services and adapters |
| [meeting-mcp-command.ts](../../src/meeting-mcp-command.ts), [meeting-read-command-bindings.ts](../../src/meeting-read-command-bindings.ts) | native command composition without expanding the main program |
| [upcoming-meetings.ts](../../src/upcoming-meetings.ts), [occurrence-schedule.ts](../../src/occurrence-schedule.ts) | bounded Zoom occurrence proof over the shared scoped reader |
| [remote-http.ts](../../src/remote-http.ts) | authenticated Zoom dispatch, retry, opt-in shared JSON byte bounds and the one download path (host check on every redirect) |
| [commands.ts](../../src/commands.ts) | shared command metadata, completion and local diagnostics |
| [zm.ts](../../src/bin/zm.ts) | process, browser, stdin and system keyring wiring |
| [recordings.ts](../../src/recordings.ts), [recording-archive.ts](../../src/recording-archive.ts) | asset discovery, streamed transfers and verified skipping |
| [recording-manifest.ts](../../src/recording-manifest.ts) | archive manifests, the verified-size cache, archive inspection and verification |
| [recording-sync.ts](../../src/recording-sync.ts), [recording-sync-store.ts](../../src/recording-sync-store.ts) | shared catalog/checkpoint orchestration, atomic writes and the published checkpoint lease format |
| [recording-writer-lease.ts](../../src/recording-writer-lease.ts) | Zoom marker layout and public error/cancellation mapping over Core native writer leases |
| [recording-partial-store.ts](../../src/recording-partial-store.ts) | Zoom partial names/defaults and cancellation mapping over Core native persistence |
| [recording-promotion-store.ts](../../src/recording-promotion-store.ts) | owned final-promotion recovery and Zoom manifest mapping |
| [recording-schedule.ts](../../src/recording-schedule.ts), [recording-schedule-store.ts](../../src/recording-schedule-store.ts), [recording-schedule-systemd.ts](../../src/recording-schedule-systemd.ts) | captured local jobs, native metadata and Linux user timers |
| [archive-transcripts.ts](../../src/archive-transcripts.ts) | verified local WebVTT reads and bounded literal search |
| [archive-import.ts](../../src/archive-import.ts) | fully verified plans and atomic per-occurrence transcript append |
| [unified-search.ts](../../src/unified-search.ts) | validated public producer search with explicit resource scope |
| [meeting-context.ts](../../src/meeting-context.ts) | account-fixed bounded evidence, identity context and read-only task proposals |
| [meeting-integration-commands.ts](../../src/meeting-integration-commands.ts), [meeting-integration.ts](../../src/meeting-integration.ts) | explicit event/person linking through the shared context service |
| [meeting-search-commands.ts](../../src/meeting-search-commands.ts) | `search meetings`: the shared word search, plus meaning and archive sources |
| [local-transcription.ts](../../src/local-transcription.ts) | native media verification and shared transcription/speech port adaptation |
| [meeting-semantic.ts](../../src/meeting-semantic.ts) | explicit model selection and public vector/model service adaptation |
| [context-sources.ts](../../src/context-sources.ts), [meeting-communications-binding.ts](../../src/meeting-communications-binding.ts) | profile-local source grants and captured immutable identities over narrow metadata ports; Core owns querying, budgets and evidence assembly |
| [store-connection.ts](../../src/store-connection.ts) | lazy public shared-store/account adapter and the selected-profile connect request, without SQL |
| [mcp-server.ts](../../src/mcp-server.ts) | official SDK transport and shared read-only meeting tools |
| [answer-output.ts](../../src/answer-output.ts), [answers.ts](../../src/answers.ts) | commands answer with cli-core `itemOf`/`listOf` bodies printed by `renderAnswer`; `bodyOf` adapts the plain values cli-core meeting commands and MCP tools return; run metadata and MCP envelopes |
| [answer-policy.ts](../../src/answer-policy.ts) | each command's declared effects ([WC-CMD-17](https://github.com/WireCatLabs/cli-base/blob/main/docs/standards/commands.md#wc-cmd-17--declare-effects-on-every-command)) bound to shared retry and next-step policies; failure rendering |
| [streaming.ts](../../src/streaming.ts), [watch-commands.ts](../../src/watch-commands.ts), [watch-service.ts](../../src/watch-service.ts) | bounded receipts, writable completion and serial API or folder ingestion |

The API uses the signed-in participant `id` when present, else email, else registrant id. Session
`user_id` is retained inside sessions, never used as a stable person id. Guests without these keys
remain separate; the shared ingestion layer keeps ambiguous speaker names without a link.

OAuth redirects through wirecat.dev because the app uses that registered redirect. The state begins
with the local port and includes random bytes. Invalid-state requests do not end the listener.
Callback errors, timeout and successful exchange all close it. Tokens are never logged or written
to the config. Zoom errors retain numeric codes and HTTP status, not provider message values.

API summaries accept both the unified Markdown field and the captured legacy sections. Chat and
file pointers return null until a supported Zoom endpoint is connected. Missing participant or
transcript scope is a clear error naming the required scope.

The executable connects the published cli-core SQLite adapter through its public meeting and
account APIs. Only store commands open a connection; ingestion registers a profile, while reads use
storedAccount without registration. Setup failures close the store before rejecting. Tests inject a
meeting port or use fresh invented databases; memory storage is never a production fallback.

Preparation has a separate connection intent that uses Core's native read-only opener. It refuses
an absent or incompatible database without migration or index maintenance. Ordinary indexed search
keeps its normal index-refresh path. Source configuration captures profile-local IDs; a request
narrows that capture before credentials or opening. Only requested identities are resolved, and
successful pins retain detached immutable values rather than connections. Each preparation call
owns a fresh connection and Core read ledger. MCP captures definitions at startup and pins each
requested source on first use, so configuration changes require a restart. Core owns source reads,
query/window checks, budgets, citations, continuation and coverage; this host contains no SQL or
alternative assembler.

Transcript downloads validate each redirect destination before sending bearer credentials and
share a bounded timeout across the download. Stable participant sessions are deduplicated; guests
without stable identity keys stay separate. Files with equal normalized occurrence keys must have
identical contents. Source discovery errors are explicit, so a partial discovery cannot silently
advance the shared cursor.

The CLI reads its version from the packaged metadata. Config and source loading are lazy so help
and version remain available even with corrupt config, without opening a database or keyring.
Installed-package acceptance tests exercise these boundaries through the actual npm bin.

Command discovery uses cli-base's live Commander registry and completion helpers. Output uses the
shared renderer and exit-code mapping. Discovery/completion avoid config and credentials; local
doctor reads public config without opening the store or keyring. Session status inspects cached
OAuth state; an explicitly requested remote check uses the user profile endpoint or an injected adapter.
The executable supplies terminal/CI context so unattended login fails before browser launch.

A library caller can supply `connectStore({profile, externalId, intent})`, returning the meeting
port, a positive numeric account id and an asynchronous close method. The program opens only for
store commands, distinguishes read from ingestion, validates the account before source requests
and closes on every parse path. Read connectors must resolve an existing account; ingestion may
register one. Connector failures must release any resource they opened before rejecting.

`batch <file>` delegates parsing, registered meeting grammar, budgets and result formatting to
Base/Core. The executable supplies bounded file/stdin input; the program opens one lazy store and
uses its account-fixed `MeetingBatchReader`. Validation and budget refusal can finish without a
connection. Buffered JSON, JSONL or compact text reaches stdout only after close succeeds.

Profile labels map to `zm-profile:<label>` in the Zoom provider namespace. They group local data,
not remote OAuth users. File and API sources share the selected account and its cursor; import
does not advance it. The standalone connector respects the producer's MESSAGING_STORE override and
state-directory convention. No guessed numeric id or memory fallback is used.

Cloud archives keep transfer metadata rather than creating a second meeting database. Manifests
contain asset IDs, sizes and local digests, never signed URLs or tokens. Writes use temporary files
and no-overwrite promotion; repeated downloads verify existing entries. Stale-lock recovery removes
recognized dead-process markers only. Local reads and checksum verification run serially.

The shared SDK owns transfer range/validator rules, bounded catalog synchronization and checkpoint
acknowledgements, native writer ownership and stale-owner recovery. Zoom binds its existing marker
layout and errors through the public `./files` capability; each acquired lease owns its release,
including after cancellation. Core's `./persistence/native` entry owns partial-file verification,
bounded checkpoints and handle cleanup. Zoom supplies its existing partial names, persistence choice,
20 GiB default and cancellation mapping. Zoom owns trusted authenticated requests, its journal
codec and durable manifest mapping; Core owns native journal I/O and final-file publication. A missing or replaced writer marker is refused before asset download.
Downloads require an account scope; resume settings select durable partials. Prefix
hashes and file identity are verified before append. A retained owned promotion journal allows safe
recovery between final publication and manifest commitment. Zoom validates its legacy journal shape;
the shared native adapter verifies bytes and scope, syncs the final before the manifest callback and
removes only the verified owned partial after durable commitment. Untracked foreign files are preserved.
Checkpoints record prior successful callbacks, not current file integrity or provider completeness.

Daily jobs use shared pure schedule plans and UTC discovery windows. The host stores captured public
profile/client/config/runtime metadata and generates Linux systemd user units. Planning performs no
writes or subprocess calls; explicit installation verifies timer activation before acknowledging it.
Saved status is historical, and reads do not query systemd. Each run checks the selected public
configuration before credentials, then uses a fixed token manager and durable archive checkpoint.
OS timers stay in this provider package; the shared SDK can accept another scheduler or provider.

Remote management maps Zoom API bodies and numeric IDs into optional shared management ports.
Portable validation and preview/single-dispatch rules come from cli-core's meetings module; transport-specific
uncertain outcomes remain the adapter's responsibility. Other providers need only the capabilities
they support, with no Zoom dependency or duplicated orchestration. See the
[provider guide](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/MEETING-PROVIDERS.md).

Archive transcript reads open a regular no-follow file handle and use that handle for bounded reads,
size and digest verification. Strict UTF-8 decoding precedes the shared WebVTT parser. Search uses
normalized literal cue text and stops after proving an extra match beyond its limit; unread assets
remain unchecked. These commands never open the store or OAuth credentials.

The shared SDK owns cue-centered context snapshots, read/output budgets, revision fingerprints and cited
passage formatting. Zoom binds the host callbacks to its selected account, closes the connection before
finite output and uses the shared CLI/MCP adapters; it does not reconstruct transcript windows itself.

Finite command output uses shared projection, rendering, buffering and caller-owned deadlines.
Streaming commands bound each receipt and await write completion/drain. Folder watching closes the
cycle's connection before its receipt; a completed late receipt has a separate one-second deadline.
MCP tool schemas and reads come from `@wirecat/cli-core/meetings/mcp`. Initialization/discovery are connection-free;
each call injects the selected account and closes its read connection before replying. SDK request
cancellation prevents new reads while allowing an active read to settle before close.

Watching snapshots the profile, source, file settings and OAuth client before its first cycle.
API cycles use shared pull and overlap; an explicit initial bound remains until the cursor write
succeeds, then later cycles follow the stored cursor. Each cycle owns and closes a fresh connection.

Archive import verifies the entire selected VTT input before account lookup or registration. Its
opaque plan binds detached rows to verified asset hashes. The public transcript append port performs
one atomic occurrence update without loading and rewriting unrelated meeting parts. An unknown start
can append only to an existing occurrence. Receipts acknowledge ownership-checked results; the port
returns exact creation and transcript insertion/replay/supersession counts when the optional receipt
port is available. Counts and writes share the producer transaction. Legacy ports retain their
acknowledgement without guessed counts, and an invalid exact acknowledgement never triggers a second
legacy write.

Context and vector adapters use published cli-core services and store capabilities; Zoom owns
no SQL, embedding tables or model engine. Evidence uses bounded metadata/row reads. Person metadata
is exposed only after account-presence checks. Speaker names never establish identity links.
Task proposals carry stable meeting provenance and never call task persistence.

Owner-selected event and participant identity links use the pure shared context workflow and the
producer's account-bound atomic link ports. Preconditions, source ownership and target authorization
are checked in the same transaction. Only the selected identity moves; names never establish links.
Memo remains the shared notes, tags and memories interface over these same records. Zoom does not
mount another set of those commands.

Preparation reads owner notes through Core's optional preparation-notes port. The native adapter
selects existing notes and confirmed associations within the included account/series/history
anchors. Core validates references, bounds reads and output, and supplies the CLI/MCP schema.
Zoom only binds the selected account and upcoming schedule; it owns no note query or persistence.
Custom providers that omit the extended selection retain the legacy person/project note shape.

`search meetings` uses the producer's word search and an opaque cursor that can continue within a
transcript. The producer indexes newly stored records before each search, in committed batches;
coverage reports pending indexing and unknown index/archive completeness. With `--model` the same
command searches by meaning and first builds missing vectors. `search recordings` reads an archive
folder instead of the store and answers with `search all`'s `hit`. The producer owns Unicode tokenization and configured
stemming; Zoom does not duplicate either implementation. Command receipts preserve committed local writes when
cancellation follows acknowledgement.

Local transcription resolves an existing selected-account meeting before reading media or loading
a model. The native host verifies ordinary WAV files, streams bounded PCM windows and checks the
content hash again before append. The shared SDK owns preview/recognition/atomic append orchestration;
the public producer speech factory owns installed-model access. Zoom reuses the producer’s
`./speech/wav` decoder and `./files` identity and directory-sync helpers; provider-specific archive
paths, journals and trust policy remain Zoom responsibilities. Recognition uses fixed windows without inferred speaker identities.

Vector generation previews existing chunk metadata by default. Explicit generation opens and validates
the model before rebuilding current-revision chunks; saving rechecks current hashes after inference.
The producer reuses shared chunk/hash/vector caches while protecting bindings owned by other resources.
Queries embed only the input, then rank a bounded scan of existing vectors. Candidate scan completion
does not establish index or archive completeness. Model selection is explicit; local loading never
downloads a model, and remote inference is incompatible with offline execution.

Optional MCP tools share these public adapters. The model options are frozen when the server is built;
the executable captures its local profile on the first read. Discovery still avoids config, database,
keyring and model access. Tool arguments cannot override model, account or broader resource scope.

Contract 3 uses Core’s public envelope, metadata, JSONL, runnable-step and effect-policy helpers.
The host preserves source completeness/issues while assigning execution identity and duration.
Each finite JSONL answer has typed item records and one end record; empty results retain the end.
Source issues determine the successful parse’s exit status through Base’s shared mapping;
`search all` explicitly allows partial results. Cleanup still finishes before finite output flushes.
Zoom’s configuration owns only Zoom settings; it does not embed the Core settings schema.

## Upcoming occurrence SDK

`createZoomUpcomingMeetingReader(account, credentials, fetcher, options)` binds the shared Core
reader to one selected Zoom meeting/series. Credentials expose the narrow `withSignal` port;
TokenManager implements it. Construction performs no login or keyring read. Each operation validates
its identifier/window/bounds before requesting credentials, then binds refresh and HTTP reads to
its signal. Interrupted credential refresh preserves outcome_unknown. The account string labels the caller’s selected data scope; OAuth supplies remote access.

`next(id, { after, until, limit, maxReadBytes, signal })` takes absolute milliseconds in a half-open
window. `id` is a numeric Zoom meeting id, rather than a stored meeting id or recording UUID.
The byte budget applies before parsing the full detail response and again to normalized proof.
Provider metadata such as passwords, host URLs and agenda are excluded from that proof.

Core owns scope snapshots, validation and earliest-candidate selection. Zoom maps explicit
occurrence ids, absolute timestamps, durations and deleted status. It does not expand recurrences
or substitute the series start date. Recurring coverage is complete only for a matching positive
end_times count, all dated rows and no end_date_time; open, date-ended, missing or mismatched
schedules retain incomplete coverage. A small row budget fails rather than silently truncating proof.
VerifiedNext describes a unique dated candidate in a covered selected-series window. Identity,
attendance and historical archive coverage use their own sources.

The CLI preparation handler uses this adapter for one selected-series detail read and joins it
with the shared preparation service. Broad hosted/invited calendar discovery remains separate. The public [Zoom Meetings API](https://developers.zoom.us/docs/api/meetings/)
describes the detail fields and required meeting:read:meeting scope.

Core also owns the related-history port and SQL adapter. Included exact-series calls anchor
same-account related calls through current person links or confirmed global projects. Metadata
preflight precedes transcript hydration; related rows have independent lookahead and exact-series
evidence keeps output-budget priority. Skips, revision checks and cancellation remain shared service
concerns. These bounds limit returned/read metadata, not SQL scan or sort work. Zoom adds no matching
rules or SQL; other meeting providers reuse the same port and service.

Core's optional `preparationKnowledge` capability and separate assembler add accepted global
person/project facts through the same live anchor associations. Selection, scoped-subject exclusion,
UTF-8 preflight and fact validation stay in Core. Knowledge has its own lookahead and yields output
bytes to meeting evidence. Zoom binds the existing shared store unchanged; CLI, MCP and installed
SDK tests exercise that integration with invented facts, including exclusion of unreviewed proposals.

Core's optional `preparationNotes` capability and separate assembler add owner-authored global
person/project notes and annotations after accepted knowledge. Shared persistence rechecks current
associations and excludes deleted/scoped subjects and later revisions. Its UTF-8 probe includes
lookahead before hydration. References, revision, explicit source gaps and coverage survive CLI/MCP
and field projection; native installed tests verify the binding without adding provider policy or SQL.

Command vocabulary checks use the same exact cli-base pin as the runtime in `package.json`. Core and
Zoom must resolve one Base installation; installed-package proofs check that identity. No separate
vocabulary alias or widened peer range is needed.

Preparation's optional selected-project binding supplies Core's existing vocabulary resolution and
word-search ports. Core owns name-lane traversal, account/history scope, coverage, continuation and
output priority; Zoom adds no alias matching, index maintenance or membership writes. Requests
without a selected project retain their earlier reads. See the
[shared preparation SDK](https://github.com/WireCatLabs/cli-core/blob/main/docs/dev/MEETING-PREPARATION.md#word-evidence-for-a-selected-project).

Checkpoint lease markers retain the published `.lock/owner.json` and `.lock.recovery` protocol.
Moving them to a separate `.locks` directory lets older and newer processes both acquire ownership.
This host-format compatibility adapter keeps recognized local stale recovery and foreign/unrecognized
refusal until the shared lock adapter supports the existing protocol. Checkpoint file publication
already uses Core atomic writes; archive writer/partial/publication leases remain shared in Core.


Project-candidate scanning delegates account authorization, bounded evidence hydration, name/key/alias
matching and answer contracts to Core. Zoom binds only the selected existing account and vocabulary,
opens the native store read-only with preparation intent, and closes before CLI/MCP output. The MCP
tool is an explicit global-project-vocabulary grant; existing server defaults remain unchanged.

`createZoomSeriesInventoryReader` implements the optional shared one-page inventory port over
`GET /users/me/meetings?type=scheduled`. It uses the captured credential resolver, list-meetings
scope, page limit and bounded HTTP parser; no whole-array management list is called. The normalized
DTO retains only exact IDs, title, kind and unverified start hints. Scheduled inventory is not a
filter for the requested window, so recurring original starts and undated records remain visible.
The shared SDK binds continuations and reports unknown calendar completeness. Zoom's
[meeting API](https://developers.zoom.us/docs/api/meetings/#list-meetings) returns unexpired scheduled
meetings for the authenticated host; it is not every invitation or an instant-meeting archive.
Provider page tokens expire; restart the finite-window listing if Zoom refuses an old cursor.
This library export does not add a default MCP tool or a remote inventory command.
