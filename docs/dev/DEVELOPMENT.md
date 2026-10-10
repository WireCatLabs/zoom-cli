# Prerelease development

cli-meetings 0.2.0 is not yet published. For local checks, build and pack the cli-meetings release
worktree, then install that tarball without changing this package's declared dependencies:

```sh
npm install --no-save --package-lock=false --ignore-scripts /tmp/wirecat-cli-meetings-0.2.0.tgz
pnpm --config.verify-deps-before-run=false lint
pnpm --config.verify-deps-before-run=false typecheck
pnpm --config.verify-deps-before-run=false test:coverage
pnpm --config.verify-deps-before-run=false docs:check
pnpm --config.verify-deps-before-run=false build
pnpm --config.verify-deps-before-run=false smoke:bun
```

The pnpm flag prevents its dependency check from trying to replace the local tarball with the
unpublished registry version. After 0.2.0 is published, run a normal `pnpm install` and commit its
lockfile. The repository owner creates `WireCatLabs/zoom-cli` before this branch can be pushed or
made into a pull request.

`bin/zm` runs the local executable. Real login is an owner check; import and pull remain unavailable
until the shared SQLite meeting adapter is connected. Do not run them against the owner's data
using the test memory store.
