# Source from the repository root; FD9 must stay in the release shell and its children.
wirecat_release_lock() {
  _wirecat_release_wait=${1-0}
  case "$_wirecat_release_wait" in
    ''|*[!0-9]*) echo "release wait must be a nonnegative integer" >&2; return 2 ;;
  esac
  command -v flock >/dev/null 2>&1 || {
    echo "release locking requires flock" >&2
    return 1
  }
  # Keyed by package name, not folder: one package releases from several checkouts and worktrees.
  _wirecat_release_key=$(node -e '
    const { name } = JSON.parse(require("node:fs").readFileSync("package.json", "utf8"))
    if (typeof name !== "string" || !name) throw Error("package.json has no name")
    process.stdout.write(name.replace(/^@/, "").replace(/[^A-Za-z0-9._-]+/g, "-"))
  ' 2>/dev/null) && [ -n "$_wirecat_release_key" ] || {
    echo "release locking needs a package name in ./package.json" >&2
    return 1
  }
  _wirecat_release_lock="${XDG_RUNTIME_DIR:-/tmp}/leemour-release-$_wirecat_release_key.lock"
  exec 9>>"$_wirecat_release_lock"
  if flock -E 75 -w "$_wirecat_release_wait" 9; then
    printf '%s pid %s since %s\n' "$(basename "$PWD")" "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$_wirecat_release_lock.who"
  else
    _wirecat_release_status=$?
    if [ "$_wirecat_release_status" -ne 75 ]; then
      printf 'could not acquire release lock %s (flock exit %s)\n' "$_wirecat_release_lock" "$_wirecat_release_status" >&2
      return 1
    fi
    node ./config/wirecat/release-lock-info.mjs "$_wirecat_release_lock" ||
      printf 'another release holds %s; holder details unavailable\n' "$_wirecat_release_lock" >&2
    return 1
  fi
}
