import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { metaOf } from "@wirecat/cli-base/commands"
import type { Command } from "commander"
import { describe, expect, it } from "vitest"
import { createProgram } from "./program.js"
import { TokenManager } from "./tokens.js"

const unavailable = async (): Promise<never> => {
  throw new Error("unexpected IO")
}
const program = createProgram({
  configPath: join(tmpdir(), "zm-test-effects", "config.json"),
  tokens: new TokenManager({
    clientId: "example-client",
    keyring: memoryKeyring(),
    service: "example",
    fetch: unavailable,
  }),
  fetch: unavailable,
  openBrowser: unavailable,
  data: () => {},
  diagnostic: () => {},
})
const all = (command: Command, path: string[] = []): [string, Command][] =>
  command.commands.flatMap((child) => {
    const childPath = [...path, child.name()]
    return [[childPath.join(" "), child] as [string, Command], ...all(child, childPath)]
  })
const effectsOf = (path: string) => metaOf(all(program).find(([one]) => one === path)?.[1] as Command).effects

describe("command effects", () => {
  it("are declared on every command, groups included", () => {
    expect(
      all(program)
        .filter(([, command]) => !metaOf(command).effects)
        .map(([path]) => path),
    ).toEqual([])
  })

  it("write to Zoom only for login and meeting changes", () => {
    const writers = all(program)
      .filter(([, command]) => metaOf(command).effects?.remote === "write")
      .map(([path]) => path)
    expect(writers.sort()).toEqual([
      "remote-meetings cancel",
      "remote-meetings create",
      "remote-meetings update",
      "session start",
    ])
  })

  it("read Zoom for commands that call it", () => {
    for (const path of ["recordings list", "remote-meetings show", "session status"])
      expect(effectsOf(path)?.remote, path).toBe("read")
    for (const path of ["watch", "recordings sync", "recordings schedule run", "search meetings"])
      expect(effectsOf(path), path).toEqual({ remote: "read", local: "write" })
  })
})
