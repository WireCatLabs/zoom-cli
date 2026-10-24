import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { localRelease, type ReleaseRunner } from "./release-local.ts"

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "zm-release-test-"))
  const temporary = join(root, "temporary")
  mkdirSync(temporary)
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@wirecat/zoom-cli", version: "1.2.3" }))
  writeFileSync(
    join(root, "CHANGELOG.md"),
    "# Changelog\n\n## 1.2.3 — 24.10.2026\n\n### Fixed\n\n- Synthetic release.\n",
  )
  const calls: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = []
  const token = "invented-release-credential"
  const run: ReleaseRunner = (command, args, env) => {
    calls.push({ command, args, env })
    if (command === "git" && args[0] === "rev-parse") return "a".repeat(40)
    if (command === "git" && args[0] === "branch") return "main"
    if (command === "npm" && args.includes("versions")) return '["1.2.2"]'
    if (command === "codeql" && args[1] === "analyze") {
      const path = args.find((arg) => arg.startsWith("--output="))?.slice("--output=".length)
      if (!path) throw new Error("missing SARIF path")
      writeFileSync(path, JSON.stringify({ runs: [{ results: [] }] }))
    }
    if (command === "pnpm" && args[0] === "pack") writeFileSync(join(temporary, "fixture.tgz"), "synthetic tarball")
    if (command === "npm" && args[0] === "pack")
      writeFileSync(join(args.at(-1) as string, "fixture.tgz"), "synthetic tarball")
    if (command === "npm" && args.includes("dist.integrity"))
      return `sha512-${createHash("sha512").update("synthetic tarball").digest("base64")}`
    return ""
  }
  return { root, temporary, run, token, calls, env: { NPM_TOKEN: token, NODE_AUTH_TOKEN: "other-invented-credential" } }
}

it("validates and installs the packed artifact before giving only the publisher its credential", async () => {
  const f = fixture()
  await localRelease(f.root, { ...f, pause: async () => {} })
  const publish = f.calls.findIndex((call) => call.command === "npm" && call.args[0] === "publish")
  const installed = f.calls.findIndex((call) => call.command === process.execPath)
  expect(installed).toBeGreaterThan(-1)
  expect(publish).toBeGreaterThan(installed)
  for (const [index, call] of f.calls.entries()) {
    expect(call.env.NPM_TOKEN).toBe(index === publish ? f.token : undefined)
    expect(call.env.NODE_AUTH_TOKEN).toBeUndefined()
    expect(call.args).not.toContain(f.token)
  }
  expect(f.calls[publish]?.args).toContain("--ignore-scripts")
  expect(readFileSync(join(f.temporary, "publish.npmrc"), "utf8")).toContain(`\${NPM_TOKEN}`)
  expect(readFileSync(join(f.temporary, "publish.npmrc"), "utf8")).not.toContain(f.token)
  const visible = f.calls.findIndex((call) => call.args.includes("dist.integrity"))
  const tag = f.calls.findIndex((call) => call.command === "git" && call.args[0] === "tag")
  expect(tag).toBeGreaterThan(visible)
})

it.each(["coverage", "codeql", "installed"])("a failed %s gate never publishes or tags", async (failure) => {
  const f = fixture()
  const run: ReleaseRunner = (command, args, env, cwd) => {
    if (
      (failure === "coverage" && args.includes("test:coverage")) ||
      (failure === "codeql" && command === "codeql") ||
      (failure === "installed" && command === process.execPath)
    )
      throw new Error("synthetic check failure")
    return f.run(command, args, env, cwd)
  }
  await expect(localRelease(f.root, { ...f, run })).rejects.toThrow("synthetic check failure")
  expect(f.calls.some((call) => call.args[0] === "publish" || call.args[0] === "tag")).toBe(false)
  expect(f.calls.every((call) => call.env.NPM_TOKEN === undefined)).toBe(true)
})

it("an unconfirmed registry artifact is never tagged", async () => {
  const f = fixture()
  const run: ReleaseRunner = (command, args, env, cwd) =>
    args.includes("dist.integrity") ? "wrong-artifact" : f.run(command, args, env, cwd)
  await expect(localRelease(f.root, { ...f, run, pause: async () => {} })).rejects.toThrow("no tag or release")
  expect(f.calls.some((call) => call.command === "git" && call.args[0] === "tag")).toBe(false)
})

it.each(["unavailable", "different"])("does not tag a %s registry download", async (failure) => {
  const f = fixture()
  const run: ReleaseRunner = (command, args, env, cwd) => {
    if (command === "npm" && args[0] === "pack") {
      if (failure === "unavailable") throw new Error("synthetic registry download failure")
      writeFileSync(join(args.at(-1) as string, "fixture.tgz"), "different registry bytes")
      return ""
    }
    return f.run(command, args, env, cwd)
  }
  await expect(localRelease(f.root, { ...f, run, pause: async () => {} })).rejects.toThrow()
  expect(f.calls.some((call) => call.command === "git" && call.args[0] === "tag")).toBe(false)
})
