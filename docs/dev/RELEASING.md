# Releasing

Release from a clean main equal to origin/main after the implementation and release-preparation
PRs have passed CI. Date the top changelog section with the package version and release day. The
release-preparation PR raises `version` in `package.json` and runs `pnpm version:sync`, which writes it into
`src/version.ts`; `pnpm version:check` in full validation fails when the two disagree.
`bin/release` takes the machine-wide release lock and dispatches the GitHub workflow; it never reads
an npm token or publishes locally. By default it refuses an occupied lock immediately. To wait in
the shared queue, set a nonnegative timeout in seconds:

```sh
WIRECAT_RELEASE_WAIT_SECONDS=900 bin/release
```

The existing shared helper validates that timeout and owns the same lock for the whole release.
A timeout exits without dispatching; never remove another publisher's lock.

The wrapper passes the full commit it checked to the workflow. A publishing run refuses a different
commit before validation or artifact creation. If main moves between checking and dispatch, refresh
the clean checkout and repeat `bin/release`; the refused run publishes nothing. A dry run may omit
the commit, but an explicitly supplied mismatching commit is refused even for a dry run.

Full validation builds, tests, checks docs and packs once. Linux and Windows installed-package
checks run against the resulting tarball before publication. A separate job publishes only the tarball
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

After the workflow succeeds, publish the matching GitHub release entry from the reviewed,
versioned changelog. The workflow creates the npm package and annotated tag; a tag alone does
not create a GitHub release. The documentation portal compares GitHub's latest stable release
with npm, so missing release metadata prevents its release audit from completing.
Check whether the entry already exists, then use `gh release create` with `--verify-tag`, the
exact tag and a `--notes-file` containing that version's reviewed notes. Link the complete
versioned changelog for earlier history. Verify the registry tarball itself is downloadable,
in addition to the version document, before updating consumers.

## Delivery gates

- Required lint, typecheck, coverage, docs, build, Bun and installed-package acceptance checks pass.
- For a release enabling standalone persistent commands, the shared SQLite binding and account
  lookup must pass close/reopen and idempotent import tests. Library-only connector releases keep
  the executable availability limitation explicit.
- Final dependency pins and lockfile resolve from the registry.
- Live login, import and pull results are recorded truthfully; captures contain counts/types only.
- User documentation describes the delivered executable and its current limitations.

The shared store uses `wirecat.db`. cli-core 0.286.0 and later preserve legacy `messages.db` files
and their SQLite sidecars during store opens. Legacy-file retention is a separate maintenance
action. Use the published shared SQLite adapter and verify persistence with isolated store fixtures.
