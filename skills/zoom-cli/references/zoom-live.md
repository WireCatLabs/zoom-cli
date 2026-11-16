# Meetings and contacts in Zoom

The core rules in [SKILL.md](../SKILL.md) apply. These commands ask Zoom live, not the local store.

## Change a meeting in Zoom

`meetings create`, `meetings update`, `meetings cancel` and `meetings invitation` take Zoom's own meeting id (a
number), not a stored meeting id. Change a meeting only when the owner asked for this exact change.

- Create, update and cancel ask first. Without a terminal, `--yes` applies an authorized change once (else exit `7`),
  and `--dry-run` always previews: `zm personal meetings cancel 123456789 --dry-run --json`.
- Exit `14` means an uncertain dispatched write: inspect the remote state before retrying. Never automatically replay
  a creation or a cancellation.
- Over MCP a change at level `ask` runs without a question: ask the owner yourself first.

## Contacts

`zm personal contacts list` reads company and external Zoom contacts live (`name:`, `email:`, `type:` narrow it).
`contacts show` takes the `id` it returns, a Zoom user id or an email.
