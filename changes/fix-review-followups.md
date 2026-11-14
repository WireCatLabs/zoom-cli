### Changed — may break callers

- **`search meetings` without `--limit` shows 20 hits, not 100,** and a search by meaning keeps the same 20
  (cli-core's shared page size). zm has no configured page size yet, so `--limit` is the only way to change it.
- **`meetings` commands take the program's `--json [fields]` and `--jsonl`** instead of their own on/off flags, so
  `meetings list --json id,title` keeps only those fields.
- **Needs `@wirecat/cli-core` 0.663.0 and `@wirecat/cli-base` 0.100.0.**
