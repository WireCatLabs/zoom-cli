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
