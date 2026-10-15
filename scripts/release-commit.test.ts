import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { expect, it } from "vitest"

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")
const job = workflow.split("  checked-commit:\n")[1]?.split("\n  validation:")[0]
const script = job?.split("        run: |\n")[1]?.replace(/^ {10}/gm, "")
if (!script) throw new Error("release source guard is missing")
const source = "a".repeat(40)

// Publishing uses the POSIX wrapper; installed Windows packages do not invoke it.
it.skipIf(process.platform === "win32").each([
  { commit: source, dry: "false", accepted: true },
  { commit: "", dry: "false", accepted: false },
  { commit: "b".repeat(40), dry: "false", accepted: false },
  { commit: source.slice(0, 7), dry: "false", accepted: false },
  { commit: "", dry: "true", accepted: true },
  { commit: source, dry: "true", accepted: true },
  { commit: "b".repeat(40), dry: "true", accepted: false },
])("release source guard: $commit / dry=$dry", ({ commit, dry, accepted }) => {
  const result = spawnSync("/bin/sh", ["-e", "-c", script], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      MESSAGING_STORE: process.env.MESSAGING_STORE,
      WIRECAT_STATE_DIR: process.env.WIRECAT_STATE_DIR,
      COMMIT: commit,
      DRY_RUN: dry,
      GITHUB_SHA: source,
    },
    encoding: "utf8",
  })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(accepted ? 0 : 1)
  expect(result.stdout.includes("nothing is published")).toBe(!accepted)
})
