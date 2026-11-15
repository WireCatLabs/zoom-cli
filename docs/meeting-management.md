# Managing Zoom meetings

Create, change or cancel a Zoom meeting, and read its invitation, from the same `meetings` commands that read the
stored ones. These commands reach the signed-in Zoom account; the stored meeting archive does not change.

## Read a meeting's invitation

```sh
zm personal meetings invitation 123456789 --json
```

The id is Zoom's meeting number. The invitation needs the `meeting:read:invitation` scope from
[the app guide](zoom-app.md#add-archive-or-management-access). To find an upcoming series, use
[`meetings scheduled`](usage.md#find-a-scheduled-meeting-series), then
[`meetings prepare <series-id>`](usage.md#prepare-for-an-upcoming-meeting) for its stored context.

## Create, update or cancel

Create, update and cancel ask first: at a terminal zm asks y/N (default no); without one, the
command stops with `confirmation_required` (exit 7) unless `--yes` applies it once. `--dry-run`
previews the command and its permission without reaching Zoom, also when `--yes` is present. A profile whose
[permissions](configuration.md#permissions) allow `meetings.create`, `meetings.update` or `meetings.cancel` applies
without asking; `readonly` or `deny` refuses even with `--yes`.

```sh
zm personal meetings create --title "Example planning" --start-time 2026-10-20T10:00:00Z --duration-minutes 30 --json
zm personal meetings update 123456789 --title "Example review" --yes --json
zm personal meetings cancel 123456789 --occurrence-id 1760954400000 --dry-run --json
```

A create needs `--start-time`: Zoom schedules a meeting, and zm does not start an instant one. A change zm cannot
send is refused before the question. Writes are never retried. If a write was sent and its result is uncertain, the
command exits with code 14: check Zoom before you repeat it.

A cancellation applies to the meeting in Zoom, not only to its stored record. After an applied change, check the
meeting in Zoom. Use [stored search and evidence](search.md) for the preparation material.

## Meetings that ran

`meetings show <id>` reads a meeting that ran again from Zoom, with its people and transcript. The id is the
instance uuid that `meetings sync` stores, or a meeting number, which answers with its latest instance. This needs
the optional `meeting:read:past_meeting` scope.
