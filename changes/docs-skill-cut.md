### Changed — may break callers

- **The agent skill is shorter.** `SKILL.md` keeps what an agent needs on every turn (the profile rule, answering
  from stored meetings, the limits on changes, output) in about 8 KB instead of 20 KB, and links the rest in
  `skills/zoom-cli/references/`: search, people and projects, preparation, the archive, meetings in Zoom and setup.
  No rule was dropped. Names gone in 0.77.0 are corrected: `meetings link --event-id`, and
  `meetings create|update|cancel|invitation` instead of `remote-meetings`, and what `--dry-run` shows. The skill
  now tells agents that `meetings show` and `meetings list` ask Zoom by default and that `--offline` reads only the
  store. An agent that reads the skill pays about
  3,000 fewer tokens on every turn.
