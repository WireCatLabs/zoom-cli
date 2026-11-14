### Changed — may break callers

- **A `readonly` level no longer stops a sync** (cli-core 0.662.0, was 0.659.0). A command that only fetches from Zoom
  into the local store, such as `meetings sync`, runs at `readonly`; `deny` still refuses it. Commands that write the
  owner's files or call another service stay blocked by `readonly`. A profile that used `readonly` to stop syncing
  sets the key to `deny`.
- **`meetings list` and `meetings show` take `--backend archive|server|both`** (cli-core 0.660.0, default `both`).
  zm does not search Zoom from these commands yet, so `both` answers from the store with a `missing` line and
  `meta.complete: false`, `--backend server` refuses, and `--backend archive` gives the old store-only answer. Items
  carry `provider_id`, and `meetings show` takes Zoom's id besides the store number. `--since-time` takes `7d` and
  other spans ago.
- **`meetings list` reads dates in the computer's zone** (cli-core 0.660.0), not in UTC.

### Fixed

- **`readonly` keeps stopping `recordings schedule run`.** The run downloads recordings into the job's saved folder,
  which it does not take as an option, so it is marked as writing the owner's files.
