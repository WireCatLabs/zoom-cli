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
  _wirecat_release_lock="${XDG_RUNTIME_DIR:-/tmp}/leemour-release.lock"
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
