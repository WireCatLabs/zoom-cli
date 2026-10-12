# Search and evidence

Find what was said in your stored meetings, read the exact passage with a reference back to it, see
what you discussed with a person, link meetings to events and people, and preview a follow-up task
tied to its source.

## Start with a question

```text prompt
Find discussions about Research Example in my stored meetings. Show the dates and the passages
about the launch decision. Include references and tell me which transcripts or periods are missing.
```

The agent should identify the meeting, open the matching passage and distinguish a recorded
participant from a person merely named in the text. Check the surrounding cues before accepting
a decision or promise. An empty search result does not prove that a discussion never happened.

For a quick local word search:

```sh
zm meetings search "example plan" --json
```

This searches the stored profile, not Zoom's live history. [Pull or import missing meetings](archive.md)
first. For indexed matches with word forms and continuation inside long transcripts, use the next steps.

## Search stored meetings

For bounded text search, first index queued meeting records explicitly, then page through hits:

```sh
zm meetings search-index --limit 100 --max-read-bytes 4194304 --json
zm meetings search-index --limit 100 --yes --json
zm meetings search-page "example plan" --limit 20 --json
zm meetings search-page "example plan" --limit 20 --after <nextCursor> --json
```

Indexing previews by default; `--yes` applies one bounded batch and `--dry-run` overrides it.
Repeat until the applied receipt reports `remaining: 0`. A search read never processes indexing
work. Its coverage reports pending indexing and unknown index/archive completeness. All normalized
query words must match, through literal prefixes or the stored stemming configuration. The default
configuration adds English, Russian and Spanish word stems; a store can disable or customize it.
This is keyword search, with no semantic model or query operators. `--meeting-id`, `--since` and
`--until` narrow the selected account. The opaque cursor belongs to that account, query and filters;
it can continue inside a large transcript. JSONL preserves the complete page, including `nextCursor`.

## Narrow by people and work

Combine a participant identity or explicitly linked person with a project and date range:

```sh
zm meetings people "Alice Example" --json
zm meetings search-page "launch" --identity-id 12 --project RES --since 2026-09-12 --until 2026-10-12 --json
zm meetings search-page "budget" --person-id 7 --topic costs --since 2026-09-12 --json
zm meetings search-page "launch" --tag planning --limit 20 --json
```

The IDs and labels above are fictional: replace them with records in your local store. Use the
`identityId` from participant results for `--identity-id`; `--person-id` takes the numeric ID of
an explicitly linked person. Several participants with the same display name may be different
identities. Inspect them before linking; these filters select meetings and do not identify who
spoke an anonymous transcript cue.

`--project` accepts an existing canonical project name, key or explicit alias. Only confirmed
meeting membership counts; an agent's proposed membership or a matching transcript word does
not establish membership. `--tag` and `--topic` accept canonical names or explicit aliases of
labels already attached to a meeting; choose one label filter. Missing or ambiguous vocabulary
names fail instead of silently broadening the search. The result's `selection` lists resolved
name filters. Date-only bounds use midnight UTC; use a timestamp with an explicit offset when
you need the start or end of a local day. Existing continuation and coverage rules still apply.

If a meeting has not been linked to a project or labelled yet, start with word search and inspect
the evidence before organising it with [Memo's shared records](https://wirecat.dev/en/docs/memo/usage).
The read-only MCP tool `meeting_search_page` provides the same filters in the server-selected
account, using `identity_id`, `person_id`, `project`, `tag`, `topic`, `since` and `until`;
its dates are epoch milliseconds.

`meetings search` keeps its existing literal prefix transcript search over stored transcripts, chat
and summaries; `--since`, `--until`, `--event-id` and `--series-id` narrow it. `meetings people <query>`
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
can leave context incomplete. Link a participant to a person explicitly with `meetings link-person`.

## Link meetings to events and people

Stored meeting references use `meeting:<accountId>/<meetingId>`. A retained transcript appends its
revision id, and a cue appends its position. Event and person linking accept root references:

```sh
zm meetings link-event meeting:1/1 --event-id 1 --expected-event-id none --json
zm meetings link-event meeting:1/1 --event-id 1 --expected-event-id none --yes --json
zm meetings link-person meeting:1/1 --participant-id 1 --person 1 --expected-person none --yes --json
```

These local changes preview by default; `--yes` applies once and `--dry-run` overrides it. Expected
link options reject a stale decision. Use `--event-id none` to unlink an event. Person linking moves
only the selected participant's identity; it never guesses a person from a speaker name. Target
people must have authorized account observations. Explicit `--target-accounts <ids>` adds account
ids for that lookup. Profile labels group local data and do not authenticate a remote identity.

## Notes, tags and memories with memo

Use [memo](https://github.com/WireCatLabs/cli-memo) for the existing shared notes, tags and memories
interface. Both tools use the same store; point `MESSAGING_STORE` at the same file if it is
overridden. For a Zoom profile named `AliceExample`, its provider account key is
`zm-profile:AliceExample`:

```sh
memo tags add planning --meeting 1 --provider zoom --account zm-profile:AliceExample --json
memo tags remove planning --meeting 1 --provider zoom --account zm-profile:AliceExample --json
memo notes add --text "Alice Example follow-up" --meeting 1 --provider zoom --account zm-profile:AliceExample --json
memo notes list --about meeting:1/1 --json
memo facts add "Alice Example will review" --type promise --scope work --subject meeting:1/1 --evidence meeting:1/1/1/0 --json
memo facts list --subject meeting:1/1 --json
```

Memo's add/remove commands write directly to the local store. Owner-authored facts are accepted;
agent-authored facts submitted through Memo MCP stay proposed until reviewed. Memories keep summaries,
digests and preferences separately. Meeting revision and cue evidence remains
addressable after corrections. The references and ids above are invented examples; use ids from
your stored meetings and selected account.

## Task proposals

Task proposals support question, request, mention and promise; `applied: false` and
`persistence: "proposal-only"` mean no task was created. `zm` does not find commitments on its own:
an agent reads transcripts and evidence, then proposes a task for the passage it chose.

Before saving notes, tags or facts, ask your agent to show the existing project aliases and labels,
then propose the links it intends to add. Review possible tag synonyms rather than creating another
label for the same subject. Memo is installed separately and must use the same database path.

Searching by meaning instead of by words is covered in [topic search](topic-search.md). For an upcoming
call, combine these cited passages with [the Zoom schedule](remote-meetings.md).
