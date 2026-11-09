### Added

- **A pull request adds its changelog entries as a fragment, `changes/<branch>.md`.** Open pull requests no longer
  conflict under `## Unreleased`. `pnpm docs:check` checks each fragment, and `bin/release` collects them into the
  version's section. An entry under `## Unreleased` still works during the move.
