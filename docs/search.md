# Search and evidence

Find what was said in your stored meetings, read the exact passage with a reference back to it, see
what you discussed with a person, link meetings to events and people, and preview a follow-up task
tied to its source.

<a id="search-stored-meetings" />

## Start with a question

```text prompt
Find discussions about Research Example in my stored meetings. Show the dates and the passages
about the launch decision. Include references and tell me which transcripts or periods are missing.
```

The agent should identify the meeting, open the matching passage and distinguish a recorded
participant from a person merely named in the text. Check the surrounding cues before accepting
a decision or promise. An empty search result does not prove that a discussion never happened.

Search the stored meetings:

```sh
zm search meetings "example plan" --json
zm search meetings "example plan" --limit 20 --cursor <next_cursor> --json
```

This searches the stored profile, not Zoom's live history. [Pull or import missing meetings](archive.md)
first. `search meetings` indexes whatever was stored since the last search before it reads, so there is no
separate index step. All query words must match, through literal prefixes or stored word forms. The default
configuration adds English, Russian and Spanish word stems; a store can disable or customize it. The query is
plain words, with no operators. `--meeting-id`, `--event-id`, `--series-id`, `--since-time` and `--until-time`
narrow the selected account. The opaque cursor belongs to that account, query and filters; it can continue
inside a large transcript. JSON provides `page.next_cursor`, `next` and any `missing` index information. JSONL emits hit records followed by an end record with the page and completeness. Hits include the cited `ref`,
meeting reference `meeting`, `excerpt` and `offset_ms`; expand a cue with `meetings passage`.

## Search by meaning or in an archive

`--model <model>` searches by meaning instead of by words, building missing vectors first; see
[topic search](topic-search.md). Store filters do not apply to a search by meaning.

`search recordings <directory> <query>` searches the transcripts of a downloaded archive folder before
any import, with no store, configuration or login:

```sh
zm search recordings ./zoom-archive "example plan" --limit 100 --offline --json
```

Its hits are the ones `search all` answers with: `ref` (`recording:<file id>/<cue position>`), `title`,
`timestamp`, `excerpt`, `sender_name` and `offset_ms`; `account` is the archive folder.

## Narrow by people and work

Combine a participant identity or explicitly linked person with a project and date range:

```sh
zm meetings people "Alice Example" --json
zm search meetings "launch" --identity-id 12 --project RES --since-time 2026-09-12 --until-time 2026-10-12 --json
zm search meetings "budget" --person-id 7 --topic costs --since-time 2026-09-12 --json
zm search meetings "launch" --tag planning --limit 20 --json
```

The IDs and labels above are fictional: replace them with records in your local store. Use the
`identity_id` from participant results for `--identity-id`; `--person-id` takes the numeric ID of
an explicitly linked person. Several participants with the same display name may be different
identities. Inspect them before linking; these filters select meetings and do not identify who
spoke an anonymous transcript cue.

`--project` accepts an existing canonical project name, key or explicit alias. Only confirmed
meeting membership counts; an agent's proposed membership or a matching transcript word does
not establish membership. `--tag` and `--topic` accept canonical names or explicit aliases of
labels already attached to a meeting; choose one label filter. Missing or ambiguous vocabulary
names fail instead of silently broadening the search. Date-only bounds use midnight UTC;
use a timestamp with an explicit offset when
you need the start or end of a local day. Existing continuation and coverage rules still apply.

If a meeting has not been linked to a project or labelled yet, start with word search and inspect
the evidence before organising it with [Memo's shared records](https://wirecat.dev/en/docs/memo/usage).
The read-only MCP tool `search_meetings` provides the same filters in the server-selected
account, using `identity_id`, `person_id`, `event_id`, `series_id`, `project`, `tag`, `topic`,
`since_time`, `until_time` and `cursor`; its times are epoch milliseconds.

`meetings people <query>` finds saved participant observations by name or email within the selected account.
It uses literal Unicode matching; it does not translate names or infer that two people are the same.
Use `--limit` (default 50), `--scan-limit` (default 1000) and `--max-read-bytes` (default 1048576)
to bound matching observations, inspected observations and stored name/email bytes per call.
The JSON answer keeps `item.page.has_more`, `item.page.next_cursor`, coverage and page-local identity ambiguity. JSONL keeps that report in the item record’s `data`, followed by an end record.
Follow the report's `item.next` step or repeat the same query with `--cursor`. An empty page can still have continuation.
Distinct identity IDs are candidates to review, never automatic person links. Archive completeness remains unknown.

`meetings list` filters metadata with a query, for example
`zm meetings list 'started_at:[2026-09-12 TO 2026-10-12]' --json`.
JSON returns `items`, `page` and optional `next` steps. JSONL emits each meeting in an item record,
then an end record with the page and completeness. Use `--page` to continue.
The date query replaces the former list-only `--since-time` and `--until-time` flags;
those flags remain available on transcript search and ingestion commands. `search all` uses the shared search
service and searches only meetings by default:

```sh
zm search all "example plan" --limit 100 --max-meetings 100 --json
zm meetings evidence meeting:3/15/20/0 --cues 100 --bytes 65536 --json
zm meetings context person:7 --meetings 10 --scan-limit 1000 --json
zm meetings task-proposal meeting:3/15/20/0 --type promise --json
```

Broader search requires explicit `--only messages,mail,notes,meetings`. Message reads use the
selected local account; mail reads include stored email accounts; notes are global to the shared
store. Meeting matching uses word prefixes; unsupported meeting syntax or exact queries are reported
as skipped. A meetings-only continuation uses the returned `item.meetings.next_cursor` as
`--meeting-cursor '<json>'`, bound to its account and query. JSONL emits the report in one item record, retaining skips, coverage and cursors, followed by an end
record. Skipped sources set `complete` to false and appear in `issues`; search still exits zero.

## Read evidence

Meeting references have the form `meeting:<account>/<meeting>[/<transcript>[/<cue-position>]]`.
They are restricted to the selected local account. Transcript references retain historical revision
identity. Evidence bounds both returned content and database reads; resume with its returned cue
reference using `--cursor`, or its revision cursor using `--after-transcript-id`. These continuation
options are mutually exclusive. `--max-read-bytes` defaults to 4 MiB per page and
`--max-transcript-pages` bounds revision scanning, including empty revisions. Follow the returned
continuation and completeness fields rather than assuming a bounded response is exhaustive.

## Read around a search hit

Use a transcript hit's `ref` to check the discussion immediately before and after the matching line:

```sh
zm meetings passage meeting:3/15/20/4 --before-n 3 --after-n 4 --format markdown
zm meetings passage meeting:3/15/20/4 --before-n 0 --after-n 0 --json
```

Replace the fictional reference with one from your search result. The passage shows timestamps,
speaker labels and a reference for each line. It reads your stored transcript without contacting
Zoom. Summary and chat hits carry a meeting reference; use `meetings show` or `meetings evidence`
for those instead, because `passage` needs a transcript line reference.

`--before-n` and `--after-n` count transcript lines, including when their stored positions have gaps.
Both default to 3; the combined maximum is 999. `--bytes` bounds the included cue JSON (64 KiB by
default), while `--max-read-bytes` bounds selected stored text (4 MiB by default). A line too large
for the anchor budget fails rather than returning a misleading empty passage. The global
`--max-output-bytes` also bounds the final rendered result.

Inside `item`, check `coverage.has_before`, `has_after` and `truncated_by` before treating a passage as complete.
To extend it, open `before_ref` with more preceding lines, or `after_ref` with more following lines.
These anchors are inclusive: the boundary line repeats, so an agent can deduplicate by `ref`.
`archive_completeness: "unknown"` describes the archive, even when this local window is complete.

A corrected transcript keeps the old reference readable and marks it `superseded`; it does not
silently switch to the replacement. To reject an altered anchor, pass its previously returned
`target_fingerprint` as `--expected-fingerprint`. JSON output retains the structured cues and
fingerprints; Markdown quotes transcript content as text. Use
`--json=items.ref,items.start_ms,items.speaker_name,items.text` for compact structured cues.
Coverage and continuation remain available; field selection does not reduce the stored read.

For agents using `zm serve --mcp --meeting-context`, `meeting_passage` provides the same read,
with `reference`, `before`, `after`, `bytes`, `max_read_bytes`, `expected_fingerprint` and
`format` (`json`, `text` or `markdown`). Its account is fixed by the server. Ask the agent to quote
and cite the surrounding passage before suggesting a fact or follow-up task.

## Person context

Person context uses stored identity links and account presence, without matching speaker names.
A person linked to a meeting is not necessarily a speaker. Pending derived indexes or bounded scans
can leave context incomplete. Link a participant to a person explicitly with `meetings link`.

## Link meetings to events and people

Stored meeting references use `meeting:<accountId>/<meetingId>`. A retained transcript appends its
revision id, and a cue appends its position. Event and person linking accept root references:

```sh
zm meetings update meeting:1/1 --event-id 1 --expected-event-id none --json
zm meetings update meeting:1/1 --event-id 1 --expected-event-id none --yes --json
zm meetings link meeting:1/1 --participant-id 1 --person 1 --expected-person none --yes --json
```

These local changes preview by default; `--yes` applies once and `--dry-run` overrides it. Expected
link options reject a stale decision. Use `--event-id none` to unlink an event. Person linking moves
only the selected participant's identity; it never guesses a person from a speaker name. Target
people must have authorized account observations. Explicit `--source <accounts>` adds account
ids for that lookup. Profile labels group local data and do not authenticate a remote identity.

## Find a project before linking it

A confirmed-project filter can miss a relevant meeting that has never been linked. Use an
existing project from the shared catalog to search its canonical name, key and explicit aliases:

```sh
zm meetings people "Alice Example" --limit 50 --json
zm meetings projects evidence RES 'identity_id:12 started_at:[2026-09-14 TO 2026-10-14]' --limit 20 --json
```

The project key and identity ID are fictional. Review participant pages before choosing the
intended identity; matching names alone do not establish a person link. If the project is missing
or ambiguous, inspect the shared project catalog in Memo first. This command resolves existing
names only; it does not invent aliases or create projects, labels, person links or membership.

The answer is one `item`, keeping its canonical `project`, matched `term`, cited `hits`,
`selection`, limits, `page` and explicit `coverage`, plus run metadata. Each call reads one name
page from the existing local word index; it does not refresh that index. Run a normal word search
after ingestion when new passages need indexing. Word reads default to 4 MiB and at most 100 hits;
`--max-read-bytes` and `--limit` change those budgets. Catalog resolution has a separate 1 MiB
budget and at most 32 names. Excess vocabulary fails visibly. Archive/index completeness stays unknown.

Continue with the top-level `next` step even if `item.hits` is empty. The cursor is at `item.page.next_cursor`. Its arguments repeat the project,
selection, cursor and budgets. Within-name pages finish before the next alias begins. Relative
dates are frozen to absolute bounds in the returned query; use that query with `--cursor` so a
later day does not shift your selection. Changed vocabulary or selection can invalidate the cursor.

The optional selection query accepts exact `meeting_id`, `identity_id`, `person_id`, `tag_id`,
`event_id` and `series_id` values, each once and joined by AND, plus `started_at` dates/ranges.
Date ranges include whole UTC calendar days; quoted ISO timestamps give exact bounds. OR,
negation and confirmed project-membership filters are refused. The MCP tool
`meeting_project_evidence` takes `project`, optional `query`, `limit`, `cursor` and
`max_read_bytes`; its account is fixed by the server.

For every relevant retained cue, open `zm meetings passage <ref> --format markdown` and check the
surrounding words. `association: "unconfirmed-word-evidence"` means candidate evidence: a key
may be incidental, and repeated refs across names are the same evidence. Propose associations
only after reviewing the passage. If no project record exists yet, ordinary word search remains
available without `--project`; repeat known names manually and retain the same selection.

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
