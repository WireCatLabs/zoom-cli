# Architecture

`@wirecat/cli-core` supplies configuration paths, secure config writes and the keyring seam.
`@wirecat/cli-meetings` supplies the domain model, source/store ports, ingestion and commands.
This package contains Zoom-specific login and sources; it contains no SQL.

| Module | Responsibility |
|---|---|
| [tokens.ts](../../src/tokens.ts) | keyring-only token storage, public-client exchange and refresh |
| [login.ts](../../src/login.ts) | PKCE, loopback callback, paste fallback and listener cleanup |
| [api.ts](../../src/api.ts) | pagination, occurrence UUIDs, participant sessions and downloads |
| [files.ts](../../src/files.ts) | file contents, legacy names and source metadata |
| [config.ts](../../src/config.ts) | public client and file-source settings |
| [program.ts](../../src/program.ts) | shared commands, output and injected store dependency |
| [commands.ts](../../src/commands.ts) | shared command metadata, completion and local diagnostics |
| [zm.ts](../../src/bin/zm.ts) | process, browser, stdin and system keyring wiring |
| [recordings.ts](../../src/recordings.ts), [recording-archive.ts](../../src/recording-archive.ts) | asset discovery, streamed transfers, manifests and verified skipping |
| [recording-sync.ts](../../src/recording-sync.ts) | serial calendar-month archive synchronization |
| [archive-transcripts.ts](../../src/archive-transcripts.ts) | verified local WebVTT reads and bounded literal search |
| [archive-import.ts](../../src/archive-import.ts) | fully verified plans and atomic per-occurrence transcript append |
| [unified-search.ts](../../src/unified-search.ts) | validated public producer search with explicit resource scope |
| [meeting-context.ts](../../src/meeting-context.ts) | account-fixed bounded evidence, identity context and read-only task proposals |
| [meeting-semantic.ts](../../src/meeting-semantic.ts) | explicit model selection and public vector/model service adaptation |
| [store-connection.ts](../../src/store-connection.ts) | lazy public shared-store/account adapter, without SQL |
| [mcp-server.ts](../../src/mcp-server.ts) | official SDK transport and shared read-only meeting tools |
| [streaming.ts](../../src/streaming.ts), [watch-commands.ts](../../src/watch-commands.ts) | bounded receipts, writable completion and serial API or folder ingestion |

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

The executable connects the published cli-messaging SQLite adapter through its public meeting and
account APIs. Only store commands open a connection; ingestion registers a profile, while reads use
storedAccount without registration. Setup failures close the store before rejecting. Tests inject a
meeting port or use fresh invented databases; memory storage is never a production fallback.

Transcript downloads validate each redirect destination before sending bearer credentials and
share a bounded timeout across the download. Stable participant sessions are deduplicated; guests
without stable identity keys stay separate. Files with equal normalized occurrence keys must have
identical contents. Source discovery errors are explicit, so a partial discovery cannot silently
advance the shared cursor.

The CLI reads its version from the packaged metadata. Config and source loading are lazy so help
and version remain available even with corrupt config, without opening a database or keyring.
Installed-package acceptance tests exercise these boundaries through the actual npm bin.

Command discovery uses cli-core's live Commander registry and completion helpers. Output uses the
shared renderer and exit-code mapping. Discovery/completion avoid config and credentials; local
doctor reads public config without opening the store or keyring. Session status inspects cached
OAuth state; an explicitly requested remote check uses the user profile endpoint or an injected adapter.
The executable supplies terminal/CI context so unattended login fails before browser launch.

A library caller can supply `connectStore({profile, externalId, intent})`, returning the meeting
port, a positive numeric account id and an asynchronous close method. The program opens only for
store commands, distinguishes read from ingestion, validates the account before source requests
and closes on every parse path. Read connectors must resolve an existing account; ingestion may
register one. Connector failures must release any resource they opened before rejecting.

Profile labels map to `zm-profile:<label>` in the Zoom provider namespace. They group local data,
not remote OAuth users. File and API sources share the selected account and its cursor; import
does not advance it. The standalone connector respects the producer's MESSAGING_STORE override and
state-directory convention. No guessed numeric id or memory fallback is used.

Cloud archives keep transfer metadata rather than creating a second meeting database. Manifests
contain asset IDs, sizes and local digests, never signed URLs or tokens. Writes use temporary files
and no-overwrite promotion; repeated downloads verify existing entries. Stale-lock recovery removes
recognized dead-process markers only. Local reads and checksum verification run serially.

Archive transcript reads open a regular no-follow file handle and use that handle for bounded reads,
size and digest verification. Strict UTF-8 decoding precedes the shared WebVTT parser. Search uses
normalized literal cue text and stops after proving an extra match beyond its limit; unread assets
remain unchecked. These commands never open the store or OAuth credentials.

Finite command output uses shared projection, rendering, buffering and caller-owned deadlines.
Streaming commands bound each receipt and await write completion/drain. Folder watching closes the
cycle's connection before its receipt; a completed late receipt has a separate one-second deadline.
MCP tool schemas and reads come from cli-meetings. Initialization/discovery are connection-free;
each call injects the selected account and closes its read connection before replying. SDK request
cancellation prevents new reads while allowing an active read to settle before close.

Watching snapshots the profile, source, file settings and OAuth client before its first cycle.
API cycles use shared pull and overlap; an explicit initial bound remains until the cursor write
succeeds, then later cycles follow the stored cursor. Each cycle owns and closes a fresh connection.

Archive import verifies the entire selected VTT input before account lookup or registration. Its
opaque plan binds detached rows to verified asset hashes. The public transcript append port performs
one atomic occurrence update without loading and rewriting unrelated meeting parts. An unknown start
can append only to an existing occurrence. Receipts acknowledge ownership-checked results; the port
does not claim whether an append created a meeting or replayed existing data.

Context and vector adapters use published cli-messaging services and store capabilities; Zoom owns
no SQL, embedding tables or model engine. Evidence uses bounded metadata/row reads. Person metadata
is exposed only after account-presence checks. Speaker names never establish identity links.
Task proposals carry stable meeting provenance and never call task persistence.

Vector generation previews existing chunk metadata by default. Explicit generation opens and validates
the model before rebuilding current-revision chunks; saving rechecks current hashes after inference.
The producer reuses shared chunk/hash/vector caches while protecting bindings owned by other resources.
Queries embed only the input, then rank a bounded scan of existing vectors. Candidate scan completion
does not establish index or archive completeness. Model selection is explicit; local loading never
downloads a model, and remote inference is incompatible with offline execution.

Optional MCP tools share these public adapters. The model options are frozen when the server is built;
the executable captures its local profile on the first read. Discovery still avoids config, database,
keyring and model access. Tool arguments cannot override model, account or broader resource scope.
