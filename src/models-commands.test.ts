import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { expect, it, vi } from "vitest"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

it("lists the speech models in the folder WireCat CLIs share, without a profile", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-models-"))
  const stdout: string[] = []
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    env: { WIRECAT_STATE_DIR: directory },
    tokens: new TokenManager({ clientId: "", keyring: memoryKeyring(), service: "example", fetch }),
    fetch: async () => {
      throw new Error("unexpected network")
    },
    openBrowser: async () => {},
    data: (text) => stdout.push(text),
    diagnostic: () => {},
  }
  expect(await run(["models", "list", "--json"], deps)).toBe(0)
  const items = JSON.parse(stdout.join("")).items as { id: string; downloaded: boolean; path: string }[]
  expect(items.map((item) => item.id)).toContain("parakeet-v3")
  expect(items.every((item) => !item.downloaded && item.path.startsWith(directory))).toBe(true)
  stdout.length = 0
  expect(await run(["models", "list", "kind:text", "--json"], deps)).toBe(0)
  expect(JSON.parse(stdout.join("")).items).toEqual([])
  stdout.length = 0
  expect(await run(["models", "list", "id:parakeet-v3", "downloaded:false", "--json"], deps)).toBe(0)
  expect(JSON.parse(stdout.join("")).items.map((item: { id: string }) => item.id)).toEqual(["parakeet-v3"])
})

it("removes a model file of another version before downloading, and says so", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-models-"))
  const audio = join(directory, "models", "audio")
  await mkdir(join(audio, "parakeet-v3"), { recursive: true })
  await writeFile(join(audio, "silero_vad.onnx"), "a vad of another version")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("invented offline network")
    }),
  )
  const stderr: string[] = []
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    env: { WIRECAT_STATE_DIR: directory },
    tokens: new TokenManager({ clientId: "", keyring: memoryKeyring(), service: "example", fetch }),
    fetch: async () => {
      throw new Error("unexpected network")
    },
    openBrowser: async () => {},
    data: () => {},
    diagnostic: (text) => stderr.push(text),
  }
  expect(await run(["models", "download", "parakeet-v3", "--json"], deps)).not.toBe(0)
  expect(stderr.join("")).toContain("silero_vad.onnx: not the file this version expects")
  expect(existsSync(join(audio, "silero_vad.onnx"))).toBe(false)
  vi.unstubAllGlobals()
})

it("keeps existing model files untouched offline, even with accepted terms", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-models-offline-"))
  const audio = join(directory, "models", "audio")
  await mkdir(audio, { recursive: true })
  const vad = join(audio, "silero_vad.onnx")
  await writeFile(vad, "invented existing model bytes")
  const network = vi.fn(async (): Promise<never> => {
    throw new Error("unexpected network")
  })
  vi.stubGlobal("fetch", network)
  const stdout: string[] = [],
    stderr: string[] = []
  try {
    const deps: ProgramDeps = {
      configPath: join(directory, "config.json"),
      env: { WIRECAT_STATE_DIR: directory },
      tokens: new TokenManager({ clientId: "", keyring: memoryKeyring(), service: "example", fetch: network }),
      fetch: network,
      openBrowser: async () => {},
      data: (text) => stdout.push(text),
      diagnostic: (text) => stderr.push(text),
    }
    expect(await run(["models", "download", "parakeet-v3", "--offline", "--accept-terms", "--json"], deps)).toBe(5)
    expect(JSON.parse(stderr.at(-1) ?? "{}").error.code).toBe("permission_error")
    expect(await readFile(vad, "utf8")).toBe("invented existing model bytes")
    expect(network).not.toHaveBeenCalled()
    expect(stdout).toEqual([])
  } finally {
    vi.unstubAllGlobals()
  }
})
