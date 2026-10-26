#!/usr/bin/env bash
# Decides whether a pull request may skip the heavy checks: it changes nothing but CHANGELOG.md and the version
# (scripts/ci-fingerprint.sh) against a commit on main that scripts/release-reuse.sh proves green on every required
# check. bin/release's version pull requests are such. Any doubt prints reuse=false.
#
#   GH_TOKEN GITHUB_REPOSITORY   set by the workflow
#   CAN_REPORT                   true when the workflow's token may write check runs (not a fork, not Dependabot)
# Run in the pull request's merge commit, checked out with its parent (fetch-depth 2).
set -uo pipefail

out=${GITHUB_OUTPUT:-/dev/stdout}
summary=${GITHUB_STEP_SUMMARY:-/dev/null}
here=$(dirname "$0")

full() {
  echo "reuse=false" >>"$out"
  printf '### Version-only check: full validation\n\nReason: %s\n' "$1" >>"$summary"
  echo "full validation: $1"
  exit 0
}

[ "${CAN_REPORT:-}" = true ] || full "this run's token cannot report checks (a fork or Dependabot)"
base=$(git rev-parse --verify HEAD^1) || full "the checkout has no parent to compare with"
mine=$(bash "$here/ci-fingerprint.sh" HEAD) || full "could not fingerprint this pull request"
theirs=$(bash "$here/ci-fingerprint.sh" "$base") || full "could not fingerprint ${base:0:10}"
[ "$mine" = "$theirs" ] ||
  full "changes more than CHANGELOG.md and the version against main ${base:0:10} (fingerprint $mine, not $theirs)"

echo "base=$base" >>"$out"
echo "fingerprint=$mine" >>"$out"
COMMIT=$base PULL_REQUEST=true bash "$here/release-reuse.sh"
