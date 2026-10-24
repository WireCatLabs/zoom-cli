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

## Launch blockers (P1)

- **ZM-1** · P1 · Help examples and the packaged scenarios leave out the profile word, so copying one fails with
  `validation_error` (41 examples in `commands --json`, 39 in docs/commands.md, all 5 `scenarios/*.md`).
  Start: `examples:` in `src/*-commands.ts`, `scenarios/`, then `pnpm generate`. Also: the `archive-recordings` scenario step
  `zm recordings schedule run daily` has no profile, and a `docs/search.md` heading reads "Why zm personal does not
  search…" (a find-and-replace slip). [notes](BACKLOG-NOTES.md#zm-1)
- **ZM-2** · P1 · Docs say the MCP server is read-only; it is not, and should not be: the owner ruled
  (2026-10-23) that MCP allows writing and exposes every command, limited only by the profile's permissions. Fix
  the six claims and name the permission that limits writes. Start: docs/security.md:36,67, README.md:328,
  docs/installation.md:162, docs/index.md:31, docs/search.md:102. `zm --help` still lists `serve --mcp` as "read-only meeting tools". [notes](BACKLOG-NOTES.md#zm-2)
- **ZM-3** · P1 · 🚩 Every new user must build their own Zoom Marketplace app before the first login; there is no
  shared WireCat app. Decide: publish one through Zoom's review, a beta app, or keep "bring your own" and say so
  plainly. Start: docs/zoom-app.md:36-46. [notes](BACKLOG-NOTES.md#zm-3)
- **ZM-4** · P1 · Release what is on main: `review`, `mentions list`, chat at sync and the not-ready transcript fix
  are documented on GitHub (docs/usage.md:244-262) but npm still has 0.36.0. Start: `bin/release`, CHANGELOG
  "Unreleased".

## Next (P2)

- **ZM-5** · P2 · 🚧 `feat/saved-meeting-searches` · Saved searches: `zm <profile> searches create/run/list/show/delete`,
  waits for the cli-core release that has #1749. Start: `/home/leemour/Projects/AI/zoom-cli-wt-improve`.
- **ZM-6** · P2 · Stale MCP tool names and dev notes: `search_meetings` (docs/search.md:102), `meeting_prepare`
  (skills/zoom-cli/SKILL.md:126), "chat … return null" (docs/dev/ARCHITECTURE.md, chat is stored since #216).
- **ZM-7** · P2 · Adopt the meeting query fields `date:`, `project:`, `tag:`, `topic:` when cli-core #1754 ships.
  Start: cli-core `meetings`, then the zm search docs.
- **ZM-8** · P2 · `doctor` does not say whether a keyring is available, so a headless user learns it only when
  login fails to save. Start: `src/setup-commands.ts`. [notes](BACKLOG-NOTES.md#zm-8)
- **ZM-9** · P2 · Answer entities: 58 of 68 leaf commands declare none (WC-CMD-19); `stats`, `review`,
  `mentions list` need an entity in cli-core first (DEBT-157). Start: `zm commands --json`.
- **ZM-10** · P2 · Dependency raises: cli-base 0.49.0 → 0.50.1; open dependabot PRs #210 (MCP server 2.1 → 2.3),
  #93, #95, #96 (actions, since 14.10). Start: package.json.
- **ZM-11** · P2 · Agent end-to-end check of the meeting workflow on invented data (aliases → cited calls →
  passages → Memo findings → prepare), with the result in cli-testing.
  [plan](https://github.com/WireCatLabs/cli-private/blob/main/plans/2026-10-14-zoom-next-tasks.md)
- **ZM-24** · P2 · MCP offers every command it can: 14 of 63 are missing, 11 of them offerable — ten in zm's own exclusion list
  (`src/mcp.ts:29`: config, session, skill, `meetings embeddings`) and four in cli-core's (`meetings scheduled`,
  `meetings projects scan`, `guide`, `upgrade`). Only `watch`, `mcp` and `complete` stay out (owner, 2026-10-23).
  The MCP page already promises `meetings scheduled` and `projects scan`, which answer "no command".
- **ZM-27** · P2 · `recordings sync` folds into `recordings download`: both save recordings to disk, and `sync` means
  bringing the store up to date (owner, 2026-10-24). `download` takes the date range and resumes month by month as
  `sync` does now; `sync` goes, with no alias. Start: `src/archive-commands.ts`.
