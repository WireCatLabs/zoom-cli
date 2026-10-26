#!/usr/bin/env bash
# Decides whether release.yml may skip its validation: the release commit is the squash commit of a merged pull
# request whose head has the same git tree and every required check green. Any doubt prints reuse=false, so the
# full validation runs. Writes reuse=true|false to GITHUB_OUTPUT and the path taken, with the reason, to the summary.
#
#   GH_TOKEN GITHUB_REPOSITORY COMMIT DRY_RUN APP_REF GITHUB_REF   set by the workflow
#   EXTRA_CONTEXTS   check names required on top of the ruleset's, one per line
#   PULL_REQUEST     true when scripts/ci-unchanged.sh asks whether a commit on main is proven green: the release-only
#                    conditions (main, no dry run, Parity on main) do not apply, the summary says so
set -uo pipefail

: "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${COMMIT:?}"
repo=$GITHUB_REPOSITORY
out=${GITHUB_OUTPUT:-/dev/stdout}
summary=${GITHUB_STEP_SUMMARY:-/dev/null}
work=$(mktemp -d)
label="Release validation"
[ "${PULL_REQUEST:-}" != true ] || label="Evidence for ${COMMIT:0:10}"

trap 'rm -rf "$work"' EXIT
export COMMIT
github_actions_app=15368

full() {
  echo "reuse=false" >>"$out"
  printf '### %s: full\n\nReason: %s\n' "$label" "$1" >>"$summary"
  echo "full validation: $1"
  exit 0
}
api() { gh api "$@" 2>"$work/err"; }

if [ "${PULL_REQUEST:-}" != true ]; then
  [ "${DRY_RUN:-}" != "true" ] || full "dry run"
  [ "${GITHUB_REF:-}" = "refs/heads/main" ] || full "not a run on main"
  [ "${APP_REF:-main}" = "main" ] || full "Parity builds ${APP_REF}, not the main the pull request checked"
fi

prs=$(api "repos/$repo/commits/$COMMIT/pulls" \
  --jq '[.[] | select(.merge_commit_sha == env.COMMIT and .base.ref == "main" and .merged_at != null)] | map(.number) | join(" ")') ||
  full "could not list the pull requests of $COMMIT"
case "$prs" in
  "") full "no merged pull request has $COMMIT as its merge commit" ;;
  *" "*) full "several pull requests claim $COMMIT: $prs" ;;
esac
pr=$prs

head=$(api "repos/$repo/pulls/$pr" --jq 'select(.head.repo.full_name == .base.repo.full_name) | .head.sha') ||
  full "could not read pull request #$pr"
[ -n "$head" ] || full "pull request #$pr comes from a fork"

commit_info=$(api "repos/$repo/git/commits/$COMMIT" \
  --jq '[.tree.sha, (.parents | length), (.parents[0].sha // "none")] | join(" ")') || full "could not read commit $COMMIT"
read -r tree parents parent <<<"$commit_info"
[ "$parents" = 1 ] || full "$COMMIT has $parents parents, not a squash commit"
head_tree=$(api "repos/$repo/git/commits/$head" --jq .tree.sha) || full "could not read commit $head"
[ "$tree" = "$head_tree" ] || full "tree of $COMMIT ($tree) differs from the tree of #$pr's head ${head:0:10} ($head_tree)"

# A check on a pull request runs on head merged into the base of that moment. When the base is an ancestor of the
# head, that merge is the head itself, so the checks saw exactly this tree.
relation=$(api "repos/$repo/compare/$parent...$head" --jq .status) || full "could not compare $parent with $head"
case "$relation" in
  ahead | identical) ;;
  *) full "#$pr's head ${head:0:10} does not contain the commit main was at before the merge (${parent:0:10}): $relation" ;;
esac

api "repos/$repo/rules/branches/main" \
  --jq '[.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[] | {context, integration_id}]' \
  >"$work/ruleset.json" || full "could not read the required checks of main"
{
  cat "$work/ruleset.json"
  printf '%s\n' "${EXTRA_CONTEXTS:-}" | jq -R -s --argjson app "$github_actions_app" \
    '[split("\n")[] | select(. != "") | {context: ., integration_id: $app}]'
} | jq -s 'add' >"$work/required.json" || full "could not build the list of required checks"
[ "$(jq length "$work/required.json")" -gt 0 ] || full "main lists no required checks"

api --paginate "repos/$repo/commits/$head/check-runs" \
  --jq '.check_runs[] | {name, status, conclusion, app: .app.id}' >"$work/runs.ndjson" ||
  full "could not read the check runs of $head"

problems=$(jq -r -n --slurpfile required "$work/required.json" --slurpfile runs "$work/runs.ndjson" '
  $required[0][] as $r
  | ($runs | map(select(.name == $r.context))) as $found
  | if ($found | length) == 0 then "\($r.context): no such check run"
    elif ($found | any(.status != "completed" or .conclusion != "success"
                       or (($r.integration_id // .app) != .app)))
    then "\($r.context): " + ($found | map("\(.status)/\(.conclusion // "-")") | join(", "))
    else empty end') || full "could not compare the check runs"
[ -z "$problems" ] || full "#$pr's head ${head:0:10} is not green on every required check: $(echo "$problems" | paste -sd ';' -)"

echo "reuse=true" >>"$out"
echo "pr=$pr" >>"$out"
{
  printf '### %s: reused from #%s\n\n' "$label" "$pr"
  printf 'Tree `%s` of `%s` equals the tree of #%s head `%s`, which contains the commit main was at before the merge (`%s`).\n\n' \
    "$tree" "$COMMIT" "$pr" "$head" "$parent"
  printf 'All %s required checks are green on that head and are not run again.\n' "$(jq length "$work/required.json")"
  [ "${PULL_REQUEST:-}" = true ] ||
    printf 'Run again here: the npm audits, Parity (it reads other repositories'"'"' main, not this tree) and the package build.\n'
} >>"$summary"
echo "reusing the checks of #$pr ($head)"
