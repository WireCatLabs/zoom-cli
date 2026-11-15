import { writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { memoryMeetingStore } from "@wirecat/cli-core/meetings/testing"
import { expect, it, vi } from "vitest"
import { useProfile } from "../scripts/testing/profile.js"
import { readConfig, setConfig } from "./config.js"
import { type ProgramDeps, run } from "./program.js"
import type { RemoteMeetingsService } from "./remote-meetings.js"
import { TokenManager } from "./tokens.js"

const setup = async (permissions?: Record<string, string>) => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-permissions-"))
  const stderr: string[] = []
  const stdout: string[] = []
  const applied: (boolean | undefined)[] = []
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    tokens: new TokenManager({ clientId: "example-client", keyring: memoryKeyring(), service: "example", fetch }),
    fetch: async () => {
      throw new Error("unexpected network")
    },
    store: memoryMeetingStore(),
    accountId: 1,
    openBrowser: async () => {},
    data: (text) => stdout.push(text),
    diagnostic: (text) => stderr.push(text),
    remoteMeetings: {
      create: async (_change: unknown, options?: { apply?: boolean }) => {
        applied.push(options?.apply)
        return {
          action: "create",
          applied: options?.apply === true,
          request: { method: "POST", path: "/x" },
          meeting: { id: "900", uuid: null, title: "Example", type: 2, startedAt: null, durationMinutes: null },
        }
      },
    } as unknown as RemoteMeetingsService,
  }
  setConfig(deps.configPath, "zoom.client_id", "example-client")
  useProfile(deps.configPath, "work")
  if (permissions) setConfig(deps.configPath, "permissions", JSON.stringify(permissions), () => "work", keys)
  const error = () => JSON.parse(stderr.at(-1) ?? "{}").error
  return { deps, applied, error, stdout }
}
const keys = new Set(["meetings", "meetings.create", "meetings.list", "meetings.update"])
const create = ["meetings", "create", "--title", "Example", "--start-time", "2026-11-20T10:00:00Z", "--json"]

it("asks before a change to Zoom: --yes applies, no terminal and no --yes refuses, --dry-run previews", async () => {
  const { deps, applied, error } = await setup()
  expect(await run(create, deps)).toBe(7)
  expect(error()).toMatchObject({
    code: "confirmation_required",
    message: expect.stringContaining("meetings.create asks first"),
  })
  expect(await run([...create, "--dry-run"], deps)).toBe(0)
  expect(await run([...create, "--yes"], deps)).toBe(0)
  expect(applied).toEqual([true])
})

it("asks a y/N question at a terminal and applies only on yes", async () => {
  const { deps, applied, error } = await setup()
  deps.confirm = vi.fn(async () => false)
  expect(await run(create, deps)).toBe(130)
  expect(error()).toMatchObject({ code: "cancelled" })
  deps.confirm = vi.fn(async () => true)
  expect(await run(create, deps)).toBe(0)
  expect(deps.confirm).toHaveBeenCalledWith(expect.stringContaining("meetings create"))
  expect(await run(["--no-input", ...create], deps)).toBe(7)
  expect(applied).toEqual([true])
})

it("allow applies without --yes, and a flag never lifts readonly or deny", async () => {
  const allowed = await setup({ "meetings.create": "allow" })
  expect(await run(create, allowed.deps)).toBe(0)
  expect(allowed.applied).toEqual([true])

  const readonly = await setup({ meetings: "readonly" })
  expect(await run([...create, "--yes"], readonly.deps)).toBe(5)
  expect(readonly.error()).toMatchObject({
    code: "permission_error",
    message: expect.stringContaining("meetings is readonly"),
  })

  const denied = await setup({ meetings: "deny" })
  expect(await run(["meetings", "list", "--json"], denied.deps)).toBe(5)
  expect(denied.error().message).toContain("profile work denies meetings.list")
})

it('**the shared setup answer "read only" holds over a profile\'s allow**, and reads still run', async () => {
  const capped = await setup({ "meetings.create": "allow" })
  const shared = await mkdtemp(join(tmpdir(), "zm-test-setup-"))
  writeFileSync(join(shared, "config.json"), JSON.stringify({ setup: { permissions: "readonly" } }))
  capped.deps.env = { WIRECAT_CONFIG_DIR: shared }
  expect(await run(create, capped.deps)).toBe(5)
  expect(capped.applied).toEqual([])
  expect(capped.error().message).toContain("setup answer keeps every tool read-only")
  expect(await run(["meetings", "list", "--json"], capped.deps)).toBe(0)
})

it("a built-in ask is not loosened by a broader allow, and is by a key as deep", async () => {
  expect(await run(create, (await setup({ meetings: "allow" })).deps)).toBe(7)
  const deep = await setup({ "meetings.create": "allow" })
  expect(await run(create, deep.deps)).toBe(0)
})

it("keeps housekeeping open under deny, and refuses an unknown key or level", async () => {
  const { deps } = await setup({ meetings: "deny" })
  expect(await run(["config", "show", "--json"], deps)).toBe(0)
  expect(() => setConfig(deps.configPath, "permissions", '{"meetngs":"deny"}', () => "work", keys)).toThrow(
    /no command is called meetngs/,
  )
  expect(() => setConfig(deps.configPath, "permissions", '{"meetings":"never"}', () => "work", keys)).toThrow(
    /a level is one of/,
  )
  expect(readConfig(deps.configPath).permissions).toEqual({ work: { meetings: "deny" } })
})

it("refuses permissions that are not one JSON object", async () => {
  const { deps } = await setup()
  for (const value of ["{not json", "[]", "null"])
    expect(() => setConfig(deps.configPath, "permissions", value, () => "work", keys)).toThrow(/a JSON object/)
})

it("refuses a saved permission key that names no command until it is removed", async () => {
  const { deps, error, stdout } = await setup()
  setConfig(deps.configPath, "permissions", '{"example.nothing":"deny"}', () => "work", new Set(["example.nothing"]))
  const catalog = vi.fn(),
    download = vi.fn()
  deps.recordings = { catalog, download, list: vi.fn(), show: vi.fn() }
  const args = [
    "recordings",
    "download",
    "--since-time",
    "2026-10-01",
    "--until-time",
    "2026-10-11",
    "--output-dir",
    "unused",
    "--json",
  ]
  expect(await run(args, deps)).toBe(3)
  expect(error()).toMatchObject({
    code: "configuration_error",
    message:
      `${deps.configPath}: permissions.example.nothing names no command — remove it with ` +
      "`zm work config unset permissions.example.nothing`",
  })
  expect(stdout).toEqual([])
  expect(await run(["config", "show", "--json"], deps)).toBe(0)
  expect(await run(["config", "unset", "permissions.example.nothing", "--json"], deps)).toBe(0)
  expect(await run(["config", "set", "permissions", '{"recordings.download":"deny"}', "--json"], deps)).toBe(0)
  expect(await run(args, deps)).toBe(5)
  expect(catalog).not.toHaveBeenCalled()
  expect(download).not.toHaveBeenCalled()
})

it("refuses an instant meeting and a create without a start before asking or reaching Zoom", async () => {
  const { deps, applied, error } = await setup()
  deps.confirm = vi.fn(async () => true)
  expect(await run([...create, "--kind", "instant"], deps)).toBe(2)
  expect(await run(["meetings", "create", "--title", "Example", "--json"], deps)).toBe(2)
  expect(await run([...create, "--setting", "waiting_room=true"], deps)).toBe(2)
  expect(await run(["meetings", "update", "123456789", "--kind", "scheduled", "--json"], deps)).toBe(2)
  expect(await run(["meetings", "update", "123456789", "--setting", "waiting_room=true", "--json"], deps)).toBe(2)
  expect(error()).toMatchObject({ code: "validation_error" })
  expect(deps.confirm).not.toHaveBeenCalled()
  expect(applied).toEqual([])
})

it("names a saved remote-meetings key as one that no longer names a command", async () => {
  const { deps, error } = await setup()
  setConfig(deps.configPath, "permissions", '{"remote-meetings":"allow"}', () => "work", new Set(["remote-meetings"]))
  expect(await run(create, deps)).toBe(3)
  expect(error().message).toContain("permissions.remote-meetings names no command")
})

it("keeps the untrusted marks of a locked run when --json selects fields", async () => {
  const { deps, stdout } = await setup()
  const mark = "0123456789abcdef"
  deps.env = { ...process.env, ZM_READ_ONLY: "1", ZM_UNTRUSTED_MARK: mark }
  ;(deps.remoteMeetings as unknown as Record<string, unknown>).invitation = async (id: string) => ({
    id,
    invitation: "Example invitation",
  })
  expect(await run(["meetings", "invitation", "123456789", "--json=invitation"], deps)).toBe(0)
  expect(JSON.parse(stdout.join("")).item.invitation).toBe(
    `⟦untrusted:${mark} source=invitation⟧Example invitation⟦/untrusted:${mark}⟧`,
  )
})
