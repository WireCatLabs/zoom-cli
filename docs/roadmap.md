# Roadmap

See which meeting workflows you can use today and which need further development. The tool already
retrieves available hosted data, imports transcripts, backs up recordings and searches cited passages.
`meetings prepare` combines upcoming proof for one selected series with bounded stored context,
including related calls, accepted person/project facts and owner notes through existing person links
and confirmed projects.
An agent can combine these sources with Memo's projects, notes and people. Start with
[meeting preparation](usage.md#prepare-for-an-upcoming-meeting) or [search and evidence](search.md).

Recording backups use shared storage for writer ownership, resumable downloads and recovery after
an interrupted final save. Existing Zoom archive files remain compatible; each provider keeps its
own archive metadata format.

## Planned work

- Dedicated reviewed findings intake: an agent proposes cited facts, decisions and project tasks, with
  repeatable intake that avoids duplicate records.
- Broader meeting preparation: discover candidate series and inspect imported documents, mail,
  messages and project-name/alias candidates, then build a brief with explicit evidence and gaps.
  The current selected-series command includes accepted global person/project facts and owner notes but leaves
  those other sources unqueried; it returns stored context without generating a summary.

Project aliases, tags and notes already belong to Memo and the shared store. Another meeting
provider uses the shared meeting capabilities; a production Google Meet or Teams connector is not
included in this tool. See [the meeting guides](index.md) for the available workflows.
