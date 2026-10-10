// `cli-dev docs-check --rules` reads this. The default walks every .md under the root, and inside the
// Bash sandbox that includes the unreadable placeholders it lays over .claude/; git knows which files are real.
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { type DocsRules, JOURNAL_IDS } from "@wirecat/cli-core/release"

export const CHANGELOG = {
  headings: ["Added", "Changed — may break callers", "Fixed", "Security", "Removed"],
  unreleased: "Unreleased",
  ids: JOURNAL_IDS,
}

export function docsRules(root: string): DocsRules {
  const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*.md"], {
    cwd: root,
    encoding: "utf8",
  })
  return {
    files: listed
      .split("\n")
      .filter(Boolean)
      .map((file) => join(root, file)),
    ids: JOURNAL_IDS,
    userPage: (name) => name === "README.md",
  }
}
