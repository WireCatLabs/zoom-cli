import { describe, expect, it } from "vitest"
import { collectFragments, fragmentProblems } from "./changelog-fragments.ts"

const rules = {
  headings: ["Added", "Changed — may break callers", "Fixed", "Security", "Removed"],
  ids: ["IDEA"],
}

const changelog = [
  "# Changelog",
  "",
  "## Unreleased",
  "",
  "## 1.3.0 — 09.11.2026",
  "",
  "### Fixed",
  "",
  "- **Old style.** Written under Unreleased before fragments.",
  "",
  "## 1.2.0 — 08.11.2026",
  "",
  "### Added",
  "",
  "- **Shipped.**",
  "",
].join("\n")

describe("collectFragments", () => {
  it("merges fragments under the version's headings in order, after its own entries", () => {
    const fragments = [
      { name: "a-feat.md", text: "### Added\n\n- **A.** See [x](../docs/x.md).\n  More of it.\n" },
      { name: "b-fix.md", text: "### Fixed\n\n- **B.** Fixed.\n\n### Changed — may break callers\n\n- **C.** Gone.\n" },
    ]
    expect(collectFragments(changelog, "1.3.0", fragments, rules)).toBe(
      [
        "# Changelog",
        "",
        "## Unreleased",
        "",
        "## 1.3.0 — 09.11.2026",
        "",
        "### Added",
        "",
        "- **A.** See [x](docs/x.md).",
        "  More of it.",
        "",
        "### Changed — may break callers",
        "",
        "- **C.** Gone.",
        "",
        "### Fixed",
        "",
        "- **Old style.** Written under Unreleased before fragments.",
        "- **B.** Fixed.",
        "",
        "## 1.2.0 — 08.11.2026",
        "",
        "### Added",
        "",
        "- **Shipped.**",
        "",
      ].join("\n"),
    )
  })

  it("refuses a version without a dated section", () => {
    expect(() => collectFragments(changelog, "1.4.0", [{ name: "a.md", text: "### Fixed\n\n- a\n" }], rules)).toThrow(
      /no "## 1\.4\.0 — " section/,
    )
  })
})

describe("fragmentProblems", () => {
  it("passes a fragment with known headings and entries", () => {
    expect(fragmentProblems({ name: "fix-sync.md", text: "### Fixed\n\n- **A fix.** Why.\n" }, rules)).toEqual([])
  })

  it("names every problem with its line", () => {
    const text = "intro\n## 1.0.0\n### Fixes\n- a\n### Fixed\n\n### Fixed\n- IDEA-260 done\n"
    expect(fragmentProblems({ name: "Feat/X.md", text }, rules)).toEqual([
      'changes/Feat/X.md: name it changes/<branch>.md in lower case, "/" as "-"',
      "changes/Feat/X.md:1: text before the first ### heading",
      'changes/Feat/X.md:2: only "### <heading>" headings; the release adds the version',
      "changes/Feat/X.md:2: text before the first ### heading",
      'changes/Feat/X.md:3: "Fixes" is not one of: Added, Changed — may break callers, Fixed, Security, Removed',
      'changes/Feat/X.md:7: "Fixed" twice',
      "changes/Feat/X.md:8: internal id IDEA-260 — say what changed instead",
    ])
  })

  it("refuses an empty fragment", () => {
    expect(fragmentProblems({ name: "a.md", text: "\n" }, rules)).toEqual([
      'changes/a.md: no "### <heading>" with an entry under it',
    ])
  })
})
