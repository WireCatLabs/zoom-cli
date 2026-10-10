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
| [zm.ts](../../src/bin/zm.ts) | process, browser, stdin and system keyring wiring |

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

The default executable refuses store commands before making remote requests. Tests inject
`MeetingStore` and its account id. The SQLite implementation and account selection must be connected
from cli-messaging when its meeting adapter ships; memory storage is never a production fallback.

Transcript downloads validate each redirect destination before sending bearer credentials and
share a bounded timeout across the download. Stable participant sessions are deduplicated; guests
without stable identity keys stay separate. Files with equal normalized occurrence keys must have
identical contents. Source discovery errors are explicit, so a partial discovery cannot silently
advance the shared cursor.

The CLI reads its version from the packaged metadata. Config and source loading are lazy so help
and version remain available even with corrupt config, without opening a database or keyring.
Installed-package acceptance tests exercise these boundaries through the actual npm bin.

A library caller can supply `connectStore({profile, externalId, intent})`, returning the meeting
port, a positive numeric account id and an asynchronous close method. The program opens only for
store commands, distinguishes read from ingestion, validates the account before source requests
and closes on every parse path. Read connectors must resolve an existing account; ingestion may
register one. Connector failures must release any resource they opened before rejecting.

Profile labels map to `zm-profile:<label>` in the Zoom provider namespace. They group local data,
not remote OAuth users. File and API sources share the selected account and its cursor; import
does not advance it. The standalone bin has no production connector until the compatible shared
store and account lookup APIs are released. No guessed numeric id or memory fallback is used.
