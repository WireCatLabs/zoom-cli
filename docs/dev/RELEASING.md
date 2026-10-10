# Releasing

Release from a clean main equal to origin/main after the implementation and release-preparation
PRs have passed CI. Date the top changelog section with the package version and release day.
`bin/release` dispatches the GitHub workflow; it never reads an npm token or publishes locally.

The workflow builds, tests, checks docs and packs first. A separate job publishes only the tarball
through npm trusted publishing. A final job tags the version after the registry exposes it.
An existing published version is an error; prepare the next version through a PR.

## Trusted publisher configuration

Zoom 0.1.0 is now published. CI must be authorized for GitHub organization `WireCatLabs`, repository
`zoom-cli`, workflow `release.yml`, environment `npm`, with permission for direct `npm publish`.
The GitHub environment already exists. npm documents the settings in its
[trusted publisher guide](https://docs.npmjs.com/trusted-publishers/).

The earlier first-publication workflow reached `npm publish` and failed with E404 before the package
was bootstrapped. A dry run cannot prove publisher authorization; the real workflow must succeed.
If publishing fails, inspect its log and verify the npm publisher fields against the workflow.
No local token-reading fallback is part of this repository.

Once the workflow is on main, its package path can be checked without publication or tagging:

```sh
gh workflow run release.yml --ref main -f dry_run=true
```

A successful dry run checks packaging, not authorization to publish. Verify the actual version
document, tag and an isolated installation after every real release.

## Delivery gates

- Required lint, typecheck, coverage, docs, build, Bun and installed-package acceptance checks pass.
- For a release enabling standalone persistent commands, the shared SQLite binding and account
  lookup must pass close/reopen and idempotent import tests. Library-only connector releases keep
  the executable availability limitation explicit.
- Final dependency pins and lockfile resolve from the registry.
- Live login, import and pull results are recorded truthfully; captures contain counts/types only.
- User documentation describes the delivered executable and its current limitations.

The store rewrite uses a new `wirecat.db` and one initial migration. Keep the old `messages.db`
untouched. The SQLite adapter belongs to the separate store refactor; do not substitute test memory
storage for production persistence.
