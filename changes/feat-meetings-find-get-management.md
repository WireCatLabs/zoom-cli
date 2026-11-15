### Added

- **`meetings show` reads a meeting that ran again from Zoom,** with its people and transcript, by the instance uuid
  that `meetings sync` stores or by its meeting number (then its latest instance). It needs the optional
  `meeting:read:past_meeting` scope: add it to the Zoom app and run `zm <profile> session start` again. Without it,
  `meetings show` says the scope is missing.
- **`meetings list` finds meetings that ran in Zoom and are not stored yet.** Each page reads one page of meetings
  and the occurrences of each of them.
- **`meetings create|update|cancel|invitation`** change a Zoom meeting or read its invitation, through cli-core's
  shared meeting management. A create needs `--start-time`; zm does not start an instant meeting. A change zm cannot
  send is refused before the question.

### Changed — may break callers

- **`remote-meetings` is gone.** Use `meetings create`, `meetings update`, `meetings cancel` and
  `meetings invitation`. `remote-meetings list` and `remote-meetings show` for an upcoming meeting have no
  replacement: `meetings scheduled` lists scheduled series, and `meetings show` answers for meetings that ran.
- **`--dry-run` on `meetings create|update|cancel` shows the command and its permission,** not the request zm would
  send to Zoom, and does not check the change. A change Zoom cannot take is refused when it runs, before the question.
- **A saved `remote-meetings` permission key stops every command** until it is removed with
  `zm <profile> config unset permissions.remote-meetings`. Set `meetings.create`, `meetings.update` or
  `meetings.cancel` instead. These ask first by default.
- **`meetings update <reference> --event-id` is now `meetings link <reference> --event-id`.** `meetings update`
  changes a meeting in Zoom.
- **Built on cli-core 0.667.0 and cli-base 0.102.1** (was 0.663.0 and 0.100.0). `--json <fields>` keeps the
  untrusted marks of other people's text. See the
  [cli-core changelog](https://github.com/WireCatLabs/cli-core/blob/main/CHANGELOG.md).
