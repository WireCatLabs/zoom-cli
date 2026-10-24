---
title: Find what was said, with its line
goal: Find where a topic came up across every meeting and read the exact lines around it.
steps:
  - run: zm personal search meetings "budget review" --limit 20 --json=ref,excerpt,source.title,source.started_at
    why: words across every stored transcript and summary; each hit keeps the reference of its line
  - run: zm personal meetings passage meeting:1/12/3/140 --before-n 3 --after-n 3
    why: the cited line with three lines either side, speakers and times included
  - run: zm personal meetings evidence meeting:1/12
    why: the stored lines, chat or summary behind a meeting reference, for a hit that is not a transcript line
look:
  - ref on each hit; quote it next to any claim you make
  - an empty result is not proof the words were never said; try another form of the name or word
  - meta.complete and the page cursor when there are more hits
---

Pass the `ref` from a hit to `meetings passage` as it is. Summary and chat hits have meeting references; read them
with `meetings evidence` or `meetings show`.
