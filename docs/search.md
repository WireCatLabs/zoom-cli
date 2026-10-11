# Search and evidence

Find what was said in your stored meetings, read the exact passage with a reference back to it, see
what you discussed with a person, and preview a follow-up task tied to its source.

## Search stored meetings

`meetings search` keeps its existing literal transcript search over stored transcripts, chat and
summaries; `--since`, `--until`, `--event-id` and `--series-id` narrow it. `meetings people <query>`
finds participants by name or email. `search all` uses the shared search service and searches only
meetings by default:

```sh
zm search all "example plan" --limit 100 --max-meetings 100 --json
zm meetings evidence meeting:3/15/20/0 --cues 100 --bytes 65536 --json
zm meetings context person:7 --meetings 10 --scan-limit 1000 --json
zm meetings task-proposal meeting:3/15/20/0 --kind promise --json
```

Broader search requires explicit `--only messages,mail,notes,meetings`. Message reads use the
selected local account; mail reads include stored email accounts; notes are global to the shared
store. Meeting matching uses word prefixes; unsupported meeting syntax or exact queries are reported
as skipped. A meetings-only continuation uses the returned `meetings.nextCursor` as
`--meeting-cursor '<json>'`, bound to its account and query. JSONL emits one complete report,
retaining skips, coverage and cursors.

## Read evidence

Meeting references have the form `meeting:<account>/<meeting>[/<transcript>[/<cue-position>]]`.
They are restricted to the selected local account. Transcript references retain historical revision
identity. Evidence bounds both returned content and database reads; resume with its returned cue
reference using `--after`, or its revision cursor using `--after-transcript-id`. These continuation
options are mutually exclusive. `--max-read-bytes` defaults to 4 MiB per page and
`--max-transcript-pages` bounds revision scanning, including empty revisions. Follow the returned
continuation and completeness fields rather than assuming a bounded response is exhaustive.

## Person context

Person context uses stored identity links and account presence, without matching speaker names.
A person linked to a meeting is not necessarily a speaker. Pending derived indexes or bounded scans
can leave context incomplete.

## Task proposals

Task proposals support question, request, mention and promise; `applied: false` and
`persistence: "proposal-only"` mean no task was created. `zm` does not find commitments on its own:
an agent reads transcripts and evidence, then proposes a task for the passage it chose.

Searching by meaning instead of by words is covered in [topic search](topic-search.md).
