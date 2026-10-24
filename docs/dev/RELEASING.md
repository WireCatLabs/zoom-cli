# Releasing

Release from a clean main equal to origin/main after the implementation and release-preparation
PRs have passed CI. Date the top changelog section with the package version and release day. The
release-preparation PR raises `version` in `package.json` and runs `pnpm version:sync`, which writes it into
`src/version.ts`; `pnpm version:check` in full validation fails when the two disagree.
`bin/release` takes the machine-wide release lock and normally dispatches the GitHub workflow. By default it refuses an occupied lock immediately. To wait in
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

Full validation builds, tests, checks docs and packs once. Linux, macOS and Windows installed-package
checks run against the resulting tarball before publication. A separate job publishes only the tarball
through npm trusted publishing. A final job tags the version after the registry exposes it, then
creates the GitHub release: title is the bare version (`0.30.0`), notes are that version's
`CHANGELOG.md` section. The documentation portal compares GitHub's latest stable release with npm, so
its release audit fails until this release exists.
An existing published version is an error; prepare the next version through a PR.

## Trusted publisher configuration

Zoom 0.1.0 is now published. CI must be authorized for GitHub organization `WireCatLabs`, repository
`zoom-cli`, workflow `release.yml`, environment `npm`, with permission for direct `npm publish`.
The GitHub environment already exists. npm documents the settings in its
[trusted publisher guide](https://docs.npmjs.com/trusted-publishers/).

The earlier first-publication workflow reached `npm publish` and failed with E404 before the package
was bootstrapped. A dry run cannot prove publisher authorization; the real workflow must succeed.
If publishing fails, inspect its log and verify the npm publisher fields against the workflow.

### Local fallback

`bin/release --local` uses the same release lock and requires a clean main equal to origin/main,
an unpublished package version and its dated changelog. It requires pnpm, Bun, gitleaks, zizmor,
CodeQL (including the JavaScript security queries), npm and authenticated GitHub CLI access.
Export `NPM_TOKEN` explicitly for publication; the wrapper does not retrieve saved credentials.

All validation runs with token/secret/password/credential environment variables removed and isolated
npm configuration. The fallback checks coverage, docs, contracts, security scans, production audit,
CodeQL and packaging, then installs the exact packed tarball and runs the current host's installed-package
acceptance checks. The full workflow additionally provides the Linux, macOS and Windows matrix. Only the final
`npm publish --ignore-scripts` receives the token. The fallback verifies that npm exposes the validated
tarball's integrity and downloads those registry bytes again before creating a tag and GitHub release. Any failed check stops publication.

Once the workflow is on main, its package path can be checked without publication or tagging:

```sh
gh workflow run release.yml --ref main -f dry_run=true
```

A successful dry run checks packaging, not authorization to publish. Verify the actual version
document, tag and an isolated installation after every real release.

If tagging or the release step fails, rerun the failed `tag` job once npm shows the version; if the tag
already exists, create only the release with `gh release create v<version> --verify-tag --title <version>`
and that version's changelog section as `--notes-file`. Verify the registry tarball itself is
downloadable, in addition to the version document, before updating consumers.

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
