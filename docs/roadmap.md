# Roadmap

See which meeting workflows you can use today and which need further development. The tool already
retrieves available hosted data, imports transcripts, backs up recordings and searches cited passages.
`meetings prepare` combines upcoming proof for one selected series with bounded stored context,
including related calls, accepted person/project facts and owner notes about included earlier calls,
explicitly linked people and confirmed projects. An optional selected existing project adds cited
name/key/alias word matches, kept separate from confirmed membership.
An agent can combine these sources with Memo's projects, notes and people. Start with
[meeting preparation](usage.md#prepare-for-an-upcoming-meeting) or [search and evidence](search.md).

Recording backups use shared storage for writer ownership, resumable downloads and recovery after
an interrupted final save. Existing Zoom archive files remain compatible; each provider keeps its
own archive metadata format.

## Save reviewed findings through Memo

Memo 0.58.0 can stage cited decisions, statements and project tasks from a stored meeting for
owner review. Use an existing confirmed meeting/project link, inspect the supporting passages,
and confirm the candidates you want to save. Staging alone creates no facts or tasks; an exact
retry reuses the accepted records. See
[review meeting findings](https://wirecat.dev/en/docs/memo/memories#meeting-findings) for the
commands, preview checks and limits. Meeting preparation reads saved context; it does not accept
these findings or generate a summary.

## Planned work

- Broader meeting preparation: discover candidate series and inspect imported documents, mail,
  messages and possible projects without requiring a project selection, then build a brief with explicit evidence and gaps.
  The current selected-series command includes accepted global person/project facts and owner notes but leaves
  those other sources and unselected project vocabularies unqueried; it returns stored context without generating a summary.

Project aliases, tags and notes already belong to Memo and the shared store. Another meeting
provider uses the shared meeting capabilities; a production Google Meet or Teams connector is not
included in this tool. See [the meeting guides](index.md) for the available workflows.
