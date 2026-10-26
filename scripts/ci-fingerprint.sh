#!/usr/bin/env bash
# Prints the git tree of <rev> without CHANGELOG.md and with the version set to 0.0.0 in package.json and
# src/version.ts: two commits share it only when everything but the changelog and the version is byte for byte the
# same.
#
#   scripts/ci-fingerprint.sh [rev]   (default HEAD)
set -euo pipefail

rev=${1:-HEAD}
index=$(mktemp)
trap 'rm -f "$index"' EXIT
export GIT_INDEX_FILE=$index

# The blob of <file> at $rev with its one version line, matched by <pattern>, set to 0.0.0. Never written to the
# object store: the fingerprint is the tree id only.
neutral() {
  git show "$rev:$1" | FILE=$1 PATTERN=$2 node -e '
    const text = require("fs").readFileSync(0, "utf8")
    const line = new RegExp(process.env.PATTERN, "gm")
    const found = text.match(line)?.length ?? 0
    if (found !== 1) {
      console.error(`${process.env.FILE} has ${found} version lines, not one`)
      process.exit(1)
    }
    process.stdout.write(text.replace(line, (_, start) => `${start}0.0.0"`))
  ' | git hash-object --stdin
}

git read-tree "$rev"
git update-index --force-remove CHANGELOG.md
# Only package.json's top-level field, found by its two-space indent; anything else in the file stays as it is.
package=$(neutral package.json '^(  "version": ")[^"\n]*"')
version=$(neutral src/version.ts '^(export const VERSION = ")[^"\n]*"')
git update-index --cacheinfo "100644,$package,package.json" --cacheinfo "100644,$version,src/version.ts"
git write-tree --missing-ok
