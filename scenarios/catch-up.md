---
title: Catch up on recent meetings
goal: Bring the last few days of meetings into the store and read what each one decided.
steps:
  - run: zm meetings sync --since-time 2026-10-01 --lookback-days 3
    why: fetches new meetings, transcripts and summaries, and revisits recent ones whose transcript came late
  - run: zm meetings list "started_at:[2026-10-01 TO 2026-10-08]"
    why: the stored meetings in that window, newest first, with their local ids
  - run: zm meetings summary 12
    why: Zoom's own summary of one meeting; overview, sections and next steps
  - run: zm meetings transcript 12
    why: the transcript behind the summary, when a claim needs the exact words
look:
  - the sync's counts of meetings, transcripts and summaries added, and any it skipped
  - next_steps in each summary, which are the follow-ups
  - a meeting with no transcript yet; sync again later with --lookback-days
---

A summary is Zoom's paraphrase. Check anything you will act on against the transcript.
