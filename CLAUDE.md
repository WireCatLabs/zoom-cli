# zoom-cli — working rules

This public package implements Zoom sources over `@wirecat/cli-meetings`. Keep provider-neutral
logic in cli-meetings and database work in cli-messaging. Never include real meeting names, ids,
emails or transcript text in fixtures, docs or commits. Tests use invented people and an injected
memory keyring, never the owner's account or store.

Read [architecture](docs/dev/ARCHITECTURE.md) and [testing](docs/dev/TESTING.md) before changes.
Token values stay in the keyring. A login listener closes on success, failure and timeout.
No live check or real import before the owner authorizes it and the shared store adapter exists.

Use a branch and a worktree. Before committing, run lint, typecheck, coverage, docs checks and Bun
smoke. Conventional commits; visible changes get an Unreleased changelog entry. Never clean up
files, branches or worktrees mid-task: record them in CLEANUP.md for the owner's confirmation.
