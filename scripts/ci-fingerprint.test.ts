import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const script = fileURLToPath(new URL("./ci-fingerprint.sh", import.meta.url))
const packageJson = `{
  "name": "@wirecat/example",
  "version": "1.2.3",
  "dependencies": {
    "left-pad": "1.3.0"
  }
}
`

describe("ci-fingerprint.sh", () => {
  let repo: string
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8" }).trim()
  const fingerprint = (rev = "HEAD") => execFileSync("bash", [script, rev], { cwd: repo, env, encoding: "utf8" }).trim()
  const edit = (file: string, change: (text: string) => string) => {
    const path = join(repo, file)
    writeFileSync(path, change(readFileSync(path, "utf8")))
    git("commit", "-qam", `edit ${file}`)
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "ci-fingerprint-"))
    git("init", "-q")
    mkdirSync(join(repo, "src"))
    writeFileSync(join(repo, "package.json"), packageJson)
    writeFileSync(join(repo, "src", "version.ts"), 'export const VERSION = "1.2.3"\n')
    writeFileSync(join(repo, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n\n- a change\n")
    writeFileSync(join(repo, "src", "index.ts"), "export const answer = 42\n")
    git("add", ".")
    git("commit", "-qm", "base")
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it("stays the same when only the version and the changelog change", () => {
    const before = fingerprint()
    edit("package.json", (text) => text.replace('"version": "1.2.3"', '"version": "1.3.0"'))
    edit("src/version.ts", (text) => text.replace("1.2.3", "1.3.0"))
    edit("CHANGELOG.md", (text) => text.replace("## Unreleased", "## 1.3.0 — 2026-10-26"))
    expect(fingerprint()).toBe(before)
  })

  it("changes with one line of source", () => {
    const before = fingerprint()
    edit("src/index.ts", (text) => text.replace("42", "43"))
    expect(fingerprint()).not.toBe(before)
  })

  it("changes with a dependency bump in package.json", () => {
    const before = fingerprint()
    edit("package.json", (text) => text.replace('"left-pad": "1.3.0"', '"left-pad": "1.3.1"'))
    expect(fingerprint()).not.toBe(before)
  })

  it("changes with anything but the version in src/version.ts", () => {
    const before = fingerprint()
    edit("src/version.ts", (text) => `${text}export const NAME = "example"\n`)
    expect(fingerprint()).not.toBe(before)
  })

  it("refuses a package.json without exactly one top-level version", () => {
    edit("package.json", (text) => text.replace('  "version": "1.2.3",\n', ""))
    expect(() => execFileSync("bash", [script], { cwd: repo, env, stdio: "pipe" })).toThrow()
  })

  it("refuses a src/version.ts without exactly one version line", () => {
    edit("src/version.ts", (text) => `${text}${text}`)
    expect(() => execFileSync("bash", [script], { cwd: repo, env, stdio: "pipe" })).toThrow()
  })
})
