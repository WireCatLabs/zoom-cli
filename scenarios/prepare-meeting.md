---
title: Prepare for an upcoming meeting
goal: Get a briefing with sources for the next meeting of a series, from its past meetings.
steps:
  - run: zm personal meetings scheduled --json
    why: the series coming up in the next seven days, with their series ids
  - run: zm personal meetings prepare 8123456789 --meetings 3 --cues 10
    why: the last three meetings of that series and the lines that matter, each with its reference
  - run: zm personal meetings passage meeting:1/12/3/140 --before-n 5 --after-n 5
    why: more context around one cited line before you rely on it
look:
  - the prior occurrences the briefing used, and how many it left out
  - open questions and promises from last time, with their references
  - communications coverage when selected message or mail sources are configured
---

`meetings prepare` reads Zoom for the schedule and the store for history. It changes nothing.
