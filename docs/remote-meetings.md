# Managing Zoom meetings

Read your upcoming Zoom meetings and their invitations, and create, change or cancel a simple
meeting — each change previewed first.

## Read upcoming meetings

```sh
zm remote-meetings list --json
zm remote-meetings show 123456789 --json
zm remote-meetings invitation 123456789 --json
```

Remote meeting ids are Zoom's numeric ids; stored `meetings` commands use local database ids.
Listing uses the manifest's `meeting:read:list_meetings` scope; showing and invitations need the
optional scopes in [the app guide](zoom-app.md#add-archive-or-management-access).

## Create, update or cancel

Create, update and cancel show the proposed request by default. Add `--yes` to apply it once;
`--dry-run` always keeps the preview, including when `--yes` is present.

```sh
zm remote-meetings create --topic "Example planning" --start-time 2026-10-20T10:00:00Z --duration-minutes 30 --json
zm remote-meetings update 123456789 --topic "Example review" --yes --json
zm remote-meetings cancel 123456789 --dry-run --json
```

Only instant and scheduled creation and basic changes are supported. Remote writes are never
automatically retried. If a write was dispatched and its result is uncertain, inspect Zoom before
repeating it; the CLI reports an uncertain outcome with exit code 14.
