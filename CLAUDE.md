# zoom-cli — working rules

This public package implements Zoom sources over `@wirecat/cli-core/meetings`. Keep provider-neutral
logic and database work in cli-core. Never include real meeting names, ids,
emails or transcript text in fixtures, docs or commits. Tests use invented people and an injected
memory keyring, never the owner's account or store.

The [WireCat CLI standards](https://github.com/WireCatLabs/cli-base/blob/main/docs/standards/README.md) apply here and win over this file; it keeps only
zoom's own rules. Read [architecture](docs/dev/ARCHITECTURE.md) and [testing](docs/dev/TESTING.md) before changes.
Token values stay in the keyring. A login listener closes on success, failure and timeout.
No live check or real import before the owner authorizes it and the shared store adapter exists.

Use a branch and a worktree. The pre-commit hook checks staged lint and secrets. Conventional commits; visible changes get an Unreleased changelog entry. Never clean up
files, branches or worktrees mid-task: record them in CLEANUP.md for the owner's confirmation.

Security audits of this repository follow the shared
[security method](https://github.com/WireCatLabs/cli-testing/tree/main/docs/security) in cli-testing;
vulnerabilities are reported as the
[security policy](https://github.com/WireCatLabs/.github/blob/main/SECURITY.md) says.

## Development check budget

Hooks, pull request CI and full validation follow the handbook's
[CI rules](https://github.com/WireCatLabs/cli-base/blob/main/docs/standards/ci.md). Here `ci:quick` is `pnpm typecheck`.
