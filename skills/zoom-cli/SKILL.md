---
name: zoom-cli
description: Archive Zoom cloud recordings, read stored meeting transcripts and summaries, or manage a Zoom meeting through zm. Use for Zoom CLI workflows, not joining calls or operating the desktop video client.
metadata:
  version: "0.2.2"
---

# Zoom CLI

Use `zm commands <resource> --json` and `zm <resource> --help` for the installed version's capabilities.
Use JSON for finite reads and JSONL for foreground watches or batch synchronization. Keep diagnostics
on stderr; use `--fields` to limit returned content. `zm doctor --json` checks local setup without login.

## Recording archives

Use `recordings sync --from <date> --to <date> --destination <directory> --jsonl` to archive history
across months. It emits serial occurrence receipts and accepts up to ten calendar years.
Use `recordings list` to find cloud recording occurrences, then `recordings show <id-or-uuid>` to
inspect assets. Download with `recordings download <id-or-uuid> --destination <directory>`.
Prefer occurrence UUIDs for recurring meetings. Download access depends on Zoom scopes and the
signed-in account; attending a meeting does not imply access to its recording API.

Re-run against the same destination to skip verified manifest entries. Use `recordings archive verify`
for local checksums; it works with `--offline`. The receipt distinguishes downloaded, skipped and
unavailable assets. A failed transfer can leave earlier completed files; retry starts the incomplete
file again. Existing files are never overwritten. Do not infer HTTP byte-range resume.

Read cues with `recordings archive transcript <directory>` or search their text with
`recordings archive search <directory> <query> --limit 100`. Both work offline without configuration,
login or a database and verify each WebVTT file they read before returning results. Search can stop
before reading later files once it proves another match beyond the limit. Select `--uuid` or
comma-separated `--file-ids`; `--max-bytes` defaults to 8 MiB per file. Search is literal, normalized
and case-insensitive, with a maximum of 1000 matches. When `hasMore` is true, increase the limit or
narrow the occurrence, file or query selection;
there is no continuation cursor. These reads do not import archive assets into the database.

`recordings archive locks` inspects writer locks. `recover` previews stale lock removal; `--yes`
removes recognized dead-process locks on this machine. It does not repair incomplete manifests or
adopt untracked files. Keep active and foreign locks intact.

## Stored meeting content

Stored `meetings` ids are local database ids, different from remote Zoom ids. Use `meetings show`,
`transcript`, `summary` and `search` for local reads. `transcript --history` includes retained versions.
Export Markdown or VTT with `meetings export <id> --format markdown|vtt`; file output requires an
explicit `--output` path and never overwrites an existing file. VTT export requires an unambiguous
current transcript or an explicit transcript id.

Store commands use the shared SQLite database; `MESSAGING_STORE` selects an explicit path. Select a
local profile before import or pull. Reads require existing profile data; they do not register it. `pull --lookback-days` revisits late
transcripts. File imports preserve the API pull cursor. Serialize ingestion for the same account.
Local profile labels group stored data and do not select a different OAuth account.

`zm watch <folder> --jsonl` rescans legacy transcript files in the foreground; each cycle closes its
connection before emitting a receipt. Stop with Ctrl-C. Fully completed late receipts have at most
one second to flush; cancellation never starts another cycle. Hashed cloud archive VTT assets do
not use legacy filenames and have no direct database-import command yet.

Use `zm watch --source api --lookback-days 7 --jsonl` for repeated online pulls that revisit late
transcripts. Without a folder or explicit source, watch uses the configured source; files can use
the configured folder. `--since` and `--lookback-days` apply only to API watching. Configuration is
captured before the first cycle, so restart to change profiles or source settings.
`--since` is the initial bound until a cursor write succeeds; later cycles use cursor plus overlap.
The selected overlap also subtracts from the initial bound.

`zm serve --mcp` provides seven read-only stored meeting tools. Discovery opens no database; reads
use the selected account. MCP uses its own framing, so omit JSON/JSONL/field-selection flags.

## Remote meeting changes

`remote-meetings` uses numeric Zoom meeting ids. Create, update and cancel preview by default;
`--yes` applies a change once, and `--dry-run` always previews. Follow the user's authorization for
actual mutations. Exit code 14 means a dispatched operation has an uncertain outcome: inspect remote
state before retrying. Do not automatically retry creation or cancellation.

## Authentication and execution

Missing-scope errors name the required scope; add it to the public OAuth app and log in again.
Browser login requires interactive input; `--interactive` permits piped/JSON login only when an input
terminal is present. `--no-input` cannot approve browser consent. Never extract or print keyring tokens.
Cached `session status` does not contact Zoom; `--check` explicitly verifies remotely.

Use `--timeout <milliseconds>` for a positive whole-command deadline and cancellation for foreground
jobs. `--offline` refuses network access. Recording videos stream to disk; ordinary result output is
bounded by `--max-output-bytes`, separate from the download's per-file `--max-bytes` limit.
