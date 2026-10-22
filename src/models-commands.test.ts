import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { expect, it } from "vitest"
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
  expect(await run(["models", "audio", "list", "--json"], deps)).toBe(0)
  const items = JSON.parse(stdout.join("")).items as { id: string; downloaded: boolean; path: string }[]
  expect(items.map((item) => item.id)).toContain("parakeet-v3")
  expect(items.every((item) => !item.downloaded && item.path.startsWith(directory))).toBe(true)
})
