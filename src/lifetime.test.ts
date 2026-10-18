import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { Command } from "commander"
import { describe, expect, it } from "vitest"
import { commandDeadline } from "./execution.js"
import { createProgram } from "./program.js"
import { TokenManager } from "./tokens.js"

const unavailable = async (): Promise<never> => {
  throw new Error("unexpected IO")
}
const program = createProgram({
  configPath: join(tmpdir(), "zm-test-lifetime", "config.json"),
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

describe("command deadlines", () => {
  it("come from what each command declares, not from the default", () => {
    const declared = Object.fromEntries(
      all(program)
        .filter(([, command]) => !command.commands.length && commandDeadline(command) !== 30000)
        .map(([path, command]) => [path, commandDeadline(command)]),
    )
    expect(declared).toEqual({
      "meetings sync": 3600000,
      "meetings transcribe": 3600000,
      "recordings archive check": 3600000,
      "recordings download": 3600000,
      "recordings schedule run": 3600000,
      "recordings sync": 3600000,
      serve: undefined,
      "session start": 300000,
      watch: undefined,
    })
  })

  it("ignore the command's name", () => {
    const parent = new Command("archive")
    expect(commandDeadline(parent.command("check"))).toBe(30000)
    expect(commandDeadline(new Command("download"))).toBe(30000)
  })
})
