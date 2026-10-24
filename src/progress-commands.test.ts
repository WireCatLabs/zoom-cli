import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { recordingAssetFingerprint } from "@wirecat/cli-core/meetings"
import { expect, it, vi } from "vitest"
import { readAnswer } from "../scripts/testing/answers.js"
import { useProfile } from "../scripts/testing/profile.js"
import { type ProgramDeps, run } from "./program.js"
import { meetingProgress } from "./sync-progress.js"
import { TokenManager } from "./tokens.js"

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "zm-progress-"))
  const env = { HOME: root, WIRECAT_STATE_DIR: root }
  const output: string[] = []
  const errors: string[] = []
  const unexpected = vi.fn(async (): Promise<never> => {
    throw new Error("unexpected provider or store access")
  })
  const deps: ProgramDeps = {
    configPath: join(root, "config.json"),
    env,
    now: () => Date.parse("2026-10-01T10:00:00Z"),
    tokens: new TokenManager({ clientId: "fixture", keyring: memoryKeyring(), service: "fixture", fetch: unexpected }),
    connectStore: unexpected,
    fetch: unexpected,
    openBrowser: unexpected,
    data: (text) => output.push(text),
    diagnostic: (text) => errors.push(text),
  }
  useProfile(deps.configPath, "personal", env)
  return { root, env, deps, output, errors, unexpected }
}

it("meeting status retains unknown totals and reports an unfinished or completed pass without opening a store", async () => {
  const f = await fixture()
  const progress = meetingProgress("personal", f.env, f.deps.now)
  expect(await run(["meetings", "status", "--json"], f.deps)).toBe(0)
  expect(readAnswer(f.output.pop() ?? "{}")).toMatchObject({ done: 0, total: null, state: "partial", updated_at: null })
  progress.begin()
  progress.complete({ meetings: 3, participants: 5, transcriptRows: 12, summaries: 1, warnings: [] })
  expect(await run(["meetings", "status", "--json"], f.deps)).toBe(0)
  expect(readAnswer(f.output.pop() ?? "{}")).toMatchObject({
    done: 3,
    total: null,
    remaining: null,
    state: "complete",
    cursor_age_ms: 0,
  })
  progress.begin()
  expect(await run(["meetings", "status", "--json"], f.deps)).toBe(0)
  expect(readAnswer(f.output.pop() ?? "{}")).toMatchObject({ done: 0, state: "partial" })
  expect(f.unexpected).not.toHaveBeenCalled()
})

it("archive status counts confirmed acknowledgements, refuses another profile and never changes checkpoint bytes", async () => {
  const f = await fixture()
  const asset = {
    id: "fixture",
    type: "transcript",
    format: "VTT",
    size: 10,
    status: "completed",
    available: true,
    startedAt: null,
    endedAt: null,
  }
  const window = { from: "2026-10-01", to: "2026-10-02" }
  const path = join(f.root, ".zoom-archive-sync.json")
  const state = {
    version: 1,
    scope: { provider: "zoom", account: "zm-profile:personal" },
    configKey: "fixture",
    revision: 1,
    updatedAt: f.deps.now?.(),
    windows: [window],
    pendingWindows: [] as (typeof window)[],
    entries: [
      { externalId: "fixture-occurrence", window, assets: [asset], acknowledged: [recordingAssetFingerprint(asset)] },
    ],
  }
  await writeFile(path, JSON.stringify(state))
  const before = await readFile(path, "utf8")
  expect(await run(["recordings", "status", f.root, "--checkpoint", path, "--json"], f.deps)).toBe(0)
  expect(readAnswer(f.output.pop() ?? "{}")).toMatchObject({ done: 1, total: 1, remaining: 0, state: "complete" })
  expect(await readFile(path, "utf8")).toBe(before)
  state.pendingWindows.push(window)
  await writeFile(path, JSON.stringify(state))
  expect(await run(["recordings", "status", f.root, "--json"], f.deps)).toBe(0)
  expect(readAnswer(f.output.pop() ?? "{}")).toMatchObject({ done: 1, total: null, state: "partial" })

  state.scope.account = "zm-profile:another"
  await writeFile(path, JSON.stringify(state))
  expect(await run(["recordings", "status", f.root, "--json"], f.deps)).toBe(5)
  expect(f.output).toEqual([])
  expect(f.unexpected).not.toHaveBeenCalled()
})

it("refuses a malformed saved ingestion cursor rather than reporting invented progress", async () => {
  const f = await fixture()
  const { checkpointPath, saveCheckpoint } = await import("@wirecat/cli-core/background")
  const { zmPaths } = await import("./folders.js")
  const path = checkpointPath(zmPaths({ env: f.env }).state, "personal", "meetings")
  saveCheckpoint(path, { done: 1, cursor: { complete: "yes" } })
  expect(await run(["meetings", "status", "--json"], f.deps)).toBe(3)
  expect(f.output).toEqual([])
  expect(f.errors.join("")).toContain("saved meeting progress is invalid")
})
