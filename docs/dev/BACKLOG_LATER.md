# Backlog — later

P3: nice-to-haves, research and someday work. Same one-line format and ids as [BACKLOG.md](BACKLOG.md); an item
moves there when it becomes P2.

## Features

- **ZM-12** · P3 · Speaker names in local transcription (the rest of IDEA-196). Start: cli-core speech, `src/local-transcription.ts`.
- **ZM-13** · P3 · Meetings someone else hosted: the API lists only meetings the user scheduled (FIND-1620); a
  browser source is listed in cli-core MEETINGS.md "Providers next". Research first.
  [parity §6](https://github.com/WireCatLabs/cli-private/blob/main/research/2026-10-22-zoom-cli-parity.md)
- **ZM-14** · P3 · A reviewed preparation brief: combine `meetings scheduled`, project suggestions and the
  selected-series context, with evidence and gaps. Start: docs/roadmap.md, cli-core preparation services.
- **ZM-15** · P3 · Search history (`searches history`), as tg has. Start: cli-core `searches`.
- **ZM-16** · P3 · Daily archive jobs on macOS and Windows (Linux user timers only today). Start: `src/recording-schedule-systemd.ts`.
- **ZM-17** · P3 · Tag suggestions and reviewed synonym merging over the existing vocabulary audit (Memo/cli-core).
- **ZM-18** · P3 · Team Chat — not proposed; new scopes, large. Research only.

- **ZM-25** · P3 · Calls you only attend: record their audio on this computer with no bot joining, then
  transcribe locally — note-takers that record the device's audio capture these; zm sees only meetings you host.
- **ZM-26** · P3 · Notes per meeting: decisions, open questions and action items, each citing its transcript line.

## Standards and tooling

- **ZM-19** · P3 · Sync progress shape (WC-LIFE-14) for `meetings sync`, `recordings sync`.
- **ZM-20** · P3 · `bin/release --local` (WC-REL-14).
- **ZM-21** · P3 · Command words outside the shared vocabulary: 26 lint baseline entries (`lint/baseline/`), e.g.
  `remote-meetings`, `recordings archive`, `task-proposal`, `--project`/`--topic` with two meanings.
- **ZM-22** · P3 · Flags that differ from tg/drive on the same path (`cli-dev audit`): `search all` has no
  `--page`/`--source`/`--timezone` and no answer entity, `doctor` has no `--online`.
- **ZM-23** · P3 · Login depends on the wirecat.dev callback page; Zoom supports loopback redirects for public
  clients (docs/zoom-app.md:64-66). Research whether a loopback redirect removes that dependency.
