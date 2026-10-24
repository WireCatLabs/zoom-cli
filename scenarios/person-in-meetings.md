---
title: What meetings say about one person
goal: Find a person among meeting participants and read what past meetings say about them.
steps:
  - run: zm personal meetings people "Alice Example"
    why: participants matching a name or email, with the identity ids and any linked person
  - run: zm personal meetings context person:7 --meetings 5 --cues 40
    why: the meetings that person attended through linked identities, with the lines that mention them
  - run: zm personal search meetings "Alice" --person-id 7 --limit 20
    why: words in meetings that person attended, when you want a topic and not everything
look:
  - more than one identity for the same name; a name alone does not prove who it is
  - a participant is not the speaker of every line in that meeting
  - for the same person across messages, mail and notes, use memo guide person-brief
---

Link a participant to a person with `zm personal meetings link` (it previews; `--yes` applies). Context follows only those
links.
