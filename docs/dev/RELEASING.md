# Releasing

Release from a clean main equal to origin/main after the implementation and release-preparation
PRs have passed CI. Date the top changelog section with the package version and release day.
`bin/release` dispatches the GitHub workflow; it never reads an npm token or publishes locally.

The workflow builds, tests, checks docs and packs first. A separate job publishes only the tarball
through npm trusted publishing. A final job tags the version after the registry exposes it.
An existing published version is an error; prepare the next version through a PR.

## First publication

The Zoom package is not published yet. Before the first real release, check that the npm package
and its trusted publisher are configured for GitHub organization `WireCatLabs`, repository
`zoom-cli`, workflow `release.yml`, environment `npm`. The GitHub environment must also exist.
If npm requires a first publication before adding that publisher, an authorized npm maintainer
must bootstrap the package through their approved npm authentication flow. Never copy credentials
into the repository or use a keyring-reading release script to work around that requirement.

Once the workflow is on main, its package path can be checked without publication or tagging:

```sh
gh workflow run release.yml --ref main -f dry_run=true
```

A successful dry run checks packaging, not authorization to publish. Verify the actual version
document, tag and an isolated installation after every real release.

## Delivery gates

- Required lint, typecheck, coverage, docs, build, Bun and installed-package acceptance checks pass.
- Store commands use the shared SQLite adapter and real account selection, with close/reopen and
  idempotent import tested against a fresh temporary database.
- Final dependency pins and lockfile resolve from the registry.
- Live login, import and pull results are recorded truthfully; captures contain counts/types only.
- User documentation describes the delivered executable and its current limitations.

The store rewrite uses a new `wirecat.db` and one initial migration. Keep the old `messages.db`
untouched. The SQLite adapter belongs to the separate store refactor; do not substitute test memory
storage for production persistence.
