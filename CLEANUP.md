# Cleanup awaiting owner confirmation

- `/tmp/zm-test-*` — invented test config and transcript folders retained by the test suite; 2026-10-10.
- 2026-10-12: `.worktrees/shared-meeting-search`, branch `feat/shared-meeting-search` — consumer integration of shared bounded search filters; retain until approved cleanup.
- 2026-10-14: `.worktrees/meeting-passages`, branch `feat/meeting-passages` — retained Zoom SDK rename and cited passage integration; remove in the owner's approved cleanup batch.
- 2026-10-14: `../cli-messaging/.worktrees/meeting-passage-standards`, `../cli-messaging/.worktrees/release-meeting-passages`, `../cli-base/.worktrees/meeting-passages`, `../cli-docs/.worktrees/zoom-passages` and `~/.cache/cli-core-meeting-passages-release-2026-10-14` — retained shared SDK/vocabulary release and documentation worktrees; remove in the owner's approved cleanup batch.
- 2026-10-14: `.worktrees/meeting-passages/.worktrees/zoom-vocabulary`, branch `feat/zoom-flag-vocabulary` — unused clean checkout created while locating the framework vocabulary; retain for the owner's cleanup batch.
- 2026-10-14: `../cli-messaging/.worktrees/logging-release-validation` and `~/.cache/cli-base-meeting-release-2026-10-14` — retained isolated dependency-validation and framework-release checkouts; retain for the owner's cleanup batch.
- 2026-10-14: `~/.cache/zoom-meeting-passages-release-2026-10-14` — clean main checkout for the reviewed 0.9.0 release; retain for the owner's cleanup batch.

- 2026-10-14: `.worktrees/bounded-participants`, branch `feat/bounded-participants` — retained participant pagination and SDK compatibility checkout; remove in the owner-approved cleanup batch.
