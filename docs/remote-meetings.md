# Managing Zoom meetings

Find an upcoming call in Zoom, read its details and invitation, or preview a simple schedule change.
These commands contact the signed-in Zoom account; they do not read the saved meeting archive.
Use them to identify the next call before an agent gathers earlier discussion and project context.

## Find the next call

```text prompt
Find my next Zoom meeting about Research Example. Show its date, timezone and invitation.
Then collect earlier discussions and open questions from stored meeting transcripts, with sources.
Do not change the meeting or save inferred links.
```

The tool lists the Zoom schedule; your agent assembles context from the available local sources.
It does not synchronize Google/Outlook calendars or generate a brief automatically. Read-only
listing needs `meeting:read:list_meetings`; details and invitations need the extra permissions in
[the app guide](zoom-app.md#add-archive-or-management-access).

## Read upcoming meetings

```sh
zm remote-meetings list --json
zm remote-meetings show 123456789 --json
zm remote-meetings invitation 123456789 --json
```

Remote meeting ids are Zoom's numeric ids; stored `meetings` commands use local database ids.
Listing needs the manually added `meeting:read:list_meetings` scope; showing and invitations need the
optional scopes in [the app guide](zoom-app.md#add-archive-or-management-access).

## Create, update or cancel

Create, update and cancel show the proposed request by default. Add `--yes` to apply it once;
`--dry-run` always keeps the preview, including when `--yes` is present.

```sh
zm remote-meetings create --title "Example planning" --start-time 2026-10-20T10:00:00Z --duration-minutes 30 --json
zm remote-meetings update 123456789 --title "Example review" --yes --json
zm remote-meetings cancel 123456789 --dry-run --json
```

Only instant and scheduled creation and basic changes are supported. Remote writes are never
automatically retried. If a write was dispatched and its result is uncertain, inspect Zoom before
repeating it; the CLI reports an uncertain outcome with exit code 14.

Check the preview's topic, start time and duration before adding `--yes`. A cancellation applies to
the remote meeting, not merely its local archive record. After an applied change, read the remote
meeting again or inspect Zoom to confirm its state. Use [stored search and evidence](search.md)
for the preparation material once you have identified the intended call.
