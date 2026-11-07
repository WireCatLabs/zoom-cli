### Changed — may break callers

- **`zm search all` has no `--max-meetings` any more.** It reads the profile's meetings through their search
  index, ranked with messages, mail and notes, at most 3 hits per meeting, and pages with `--page`; it no longer
  scans the 100 newest meetings. A transcript hit carries `cue_ref` for `meetings passage`. Search all never
  builds the index: when `missing` names the account, `zm <profile> search meetings` builds it.
