### Changed — may break callers

- **cli-core 0.619.0.** An agent's `meetings link` now opens a proposal for the owner instead of linking the person.

### Fixed

- **The owner's own `meetings link --yes` and `meetings update --yes` apply at once.** zm now tells cli-core who runs
  the command: the owner at a terminal links the person right away, while an agent's terminal or an MCP run only
  proposes it. Without this, cli-core 0.619.0 would treat every link as an agent's.
