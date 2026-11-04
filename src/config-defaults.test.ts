import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { describe, expect, it } from "vitest"
import { readAnswer } from "../scripts/testing/answers.js"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const offline = async () => {
  throw new Error("unexpected network")
}

const setup = async (file?: unknown) => {
  const configPath = join(await mkdtemp(join(tmpdir(), "zm-config-defaults-")), "config.json")
  if (file !== undefined) await writeFile(configPath, JSON.stringify(file))
  const stdout: string[] = []
  const deps: ProgramDeps = {
    configPath,
    tokens: new TokenManager({
      clientId: "example-client",
      service: "example",
      keyring: memoryKeyring(),
      now: () => 0,
      fetch: offline,
    }),
    fetch: offline,
    openBrowser: offline,
    data: (text) => stdout.push(text),
    diagnostic: () => {},
    now: () => 0,
  }
  const zm = async (...args: string[]) => {
    expect(await run(["--json", ...args], deps)).toBe(0)
    return readAnswer(stdout.at(-1) ?? "{}") as Record<string, unknown>
  }
  const saved = async () => JSON.parse(await readFile(configPath, "utf8"))
  return { configPath, zm, saved }
}

describe("every setting in the config file with its default", () => {
  it("config show lists each setting's value, default and source, and writes nothing", async () => {
    const { configPath, zm } = await setup({ source: "files", profiles: { work: {} } })
    const before = await readFile(configPath, "utf8")
    const { settings } = await zm("config", "show")
    expect(settings).toContainEqual(
      expect.objectContaining({ setting: "source", value: "files", default: "api", from: "config file" }),
    )
    expect(settings).toContainEqual(expect.objectContaining({ setting: "keep_runs_for_days", from: "default" }))
    expect(await readFile(configPath, "utf8")).toBe(before)
  })

  it("config migrate adds what the file lacks, keeps values, order and unknown keys, and repeats as a no-op", async () => {
    const { configPath, zm, saved } = await setup({
      record: false,
      client_id: "example-client",
      profiles: { work: {} },
    })
    const { added } = await zm("config", "migrate")
    expect(added).toEqual(expect.arrayContaining(["source", "record_input", "runs_size_limit_mb"]))
    const file = await saved()
    expect(Object.keys(file).slice(0, 3)).toEqual(["record", "client_id", "profiles"])
    expect(file).toMatchObject({ record: false, client_id: "example-client", source: "api", keep_runs_for_days: 30 })
    expect(file).not.toHaveProperty("files_folder")
    const again = await readFile(configPath, "utf8")
    expect((await zm("config", "migrate")).added).toEqual([])
    expect(await readFile(configPath, "utf8")).toBe(again)
  })

  it("the first write holds every setting, and unset does not put back what it removed", async () => {
    const { zm, saved } = await setup()
    await zm("config", "set", "files.timezone", "Europe/Madrid")
    expect(await saved()).toMatchObject({ files_timezone: "Europe/Madrid", source: "api", record: true })
    await zm("config", "unset", "record")
    expect(await saved()).not.toHaveProperty("record")
  })
})
