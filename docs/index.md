# zm — Zoom for your AI agent

Use `zm`, the Zoom command-line tool, to find what was discussed, recover a decision with its
original passage and prepare for a follow-up. It keeps available meeting information locally and
gives your AI agent a way to read it. Your account's permissions and saved transcripts determine
which Zoom data is available.

<a id="one-minute-to-the-first-result" />

## Choose your starting point

- **Read your hosted Zoom meetings:** [install and connect](installation.md). Reuse an existing
  app, including a team app available to you, or follow the complete app-creation steps.
- **You already have VTT transcript files:** [import them](archive.md#downloaded-transcripts)
  without app creation or browser login.
- **Meetings are already stored:** [search a passage](search.md), then connect your agent through
  [a skill or MCP](mcp.md).

<a id="where-to-go-next" />

## What you can do

- Read available meeting metadata, participant sessions, transcripts and Zoom summaries.
- Keep downloaded transcripts with correction history and source references.
- Archive cloud audio/video/transcript files, verify checksums and resume supported transfers.
- Search words or meaning and combine evidence with shared notes, tags, projects and people.
- Read upcoming Zoom meetings and invitations; preview supported meeting changes before applying them.

The tool reads hosted meetings through Zoom's API or imports files you are allowed to obtain.
It does not join calls, start recording or generate missing Zoom transcripts. Its MCP connection
is read-only; terminal agents have the CLI's broader command set.

## Get a useful first answer

After connection and ingestion, ask your agent:

```text prompt
Find the latest meeting about Research Example. Give its date, participants actually recorded,
one decision and the passage supporting it. Tell me what information is missing.
```

Expect source references, not an uncited summary. Continue with [search and evidence](search.md),
or [back up recording files](archive.md#archive-cloud-recordings) if your priority is keeping the media.
