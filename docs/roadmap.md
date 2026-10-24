# Roadmap

See which meeting workflows you can use today and which need further development.

## What works today

The tool retrieves the meetings, participants, transcripts and Zoom AI summaries your account hosted, imports
transcript files you downloaded, backs up cloud recordings with checksums and searches stored meetings by words
or meaning, with a reference to each passage. `meetings prepare` gathers cited context for one selected upcoming
series. `stats meetings` shows who talked and how much. An agent can use all of this through the skill or MCP,
together with Memo's projects, notes and people.

Every command is listed in [the command reference](commands.md). Start with
[meeting preparation](usage.md#prepare-for-an-upcoming-meeting) or [search and evidence](search.md).

Memo can stage cited decisions, statements and project tasks from a stored meeting for owner review; see
[review meeting findings](https://wirecat.dev/en/docs/memo/memories#meeting-findings). Meeting preparation reads
saved context; it does not accept these findings or generate a summary.

To use your Zoom account, you connect your own Zoom app first; [the app guide](zoom-app.md) shows how.

## Also available

- `review` makes a digest of recent meetings, and `mentions list` finds links shared in meeting chat.
- Saved searches can be run again by name; meeting query fields include date, project, tag and topic.
- Profile-aware examples can be copied as shown. `doctor` checks whether this computer can save a Zoom login.
- MCP keeps supported commands discoverable; profile permissions decide which reads and writes may run.

## Later

- Calls you only attend: record audio on this computer, without a bot, then transcribe locally (ZM-25).
- Notes per meeting: decisions, open questions and action items citing transcript lines (ZM-26).
- Speaker names in transcripts made on this computer.
- Meetings someone else hosted, without asking the host for a file.
- A reviewed preparation brief that combines upcoming series, project suggestions and stored context, with
  its evidence and gaps.
- Daily recording backups on macOS and Windows.
- Google Meet and Microsoft Teams, as separate tools that use the same meeting store. They are not part of this
  tool.
