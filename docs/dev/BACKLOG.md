# Backlog

Open work for zoom-cli (`zm`), most important first: P1 and P2 only. P3 and research live in
[BACKLOG_LATER.md](BACKLOG_LATER.md). Users read what shipped in [CHANGELOG.md](../../CHANGELOG.md).
Provider-neutral meeting work belongs to cli-core (`docs/dev/MEETINGS.md`, `docs/dev/MEETING-PROVIDERS.md`);
an item here names it when zm only adopts it.

## Rules

- **An id is permanent** and never reused: `ZM-<n>`, the next number above the highest in this file and
  BACKLOG_LATER.md, on any branch.
- **One item:** id · priority · title · where the work starts · link to details. Analysis goes to a plan in the
  private notes or [BACKLOG-NOTES.md](BACKLOG-NOTES.md), a ruling to the private `DECISIONS.md`.
- **Priority:** **P1** breaks something real, tells users something untrue, or blocks install — done before
  advertising · **P2** this cycle · **P3** someday (BACKLOG_LATER.md).
- **Mark:** none — not started · 🚧 `<branch>` — taken · 🟡 — half done, the rest named ·
  ⏸️ — deferred by the owner · 🚩 — waits on an owner decision.
- **Claim before code:** put `🚧 <branch>` on the line in the first push of the branch.
- **Close in the PR that ships the work:** delete the line here in that PR.

## Next (P2)

- **ZM-5** · P2 · 🚧 `feat/saved-meeting-searches` · Saved searches: `zm <profile> searches create/run/list/show/delete`,
  waits for the cli-core release that has #1749. Start: `/home/leemour/Projects/AI/zoom-cli-wt-improve`.
- **ZM-7** · P2 · Adopt the meeting query fields `date:`, `project:`, `tag:`, `topic:` when cli-core #1754 ships.
  Start: cli-core `meetings`, then the zm search docs.
- **ZM-10** · P2 · Dependency raises: cli-base 0.49.0 → 0.50.1; open dependabot PRs #210 (MCP server 2.1 → 2.3),
  #93, #95, #96 (actions, since 14.10). Start: package.json.
- **ZM-11** · P2 · Agent end-to-end check of the meeting workflow on invented data (aliases → cited calls →
  passages → Memo findings → prepare), with the result in cli-testing.
  [plan](https://github.com/WireCatLabs/cli-private/blob/main/plans/2026-10-14-zoom-next-tasks.md)
- **ZM-27** · P2 · 🚧 `refactor/recordings-download-1024` · `recordings sync` folds into `recordings download`: both save recordings to disk, and `sync` means
  bringing the store up to date (owner, 2026-10-24). `download` takes the date range and resumes month by month as
  `sync` does now; `sync` goes, with no alias. Start: `src/archive-commands.ts`.
