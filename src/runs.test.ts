import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { expect, it } from "vitest"
import { declaredAnswerIssue } from "../scripts/testing/answers.js"
import { TEST_PROFILE, useProfile } from "../scripts/testing/profile.js"
import { readConfig, setConfig } from "./config.js"
import { createProgram, type ProgramDeps, run } from "./program.js"
import { operationOf } from "./request-events.js"
import { lazyRunLog } from "./run-log.js"
import { TokenManager } from "./tokens.js"

const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-runs-"))
  const stdout: string[] = []
  const requests: string[] = []
  const env: NodeJS.ProcessEnv = { HOME: directory, ZM_STATE_DIR: join(directory, "state") }
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    env,
    tokens: new TokenManager({
      clientId: "example-client",
      keyring: memoryKeyring(),
      service: "example",
      now: () => 0,
      fetch: async () => {
        throw new Error("unexpected refresh")
      },
    }),
    fetch: async (input) => {
      requests.push(String(input))
      return new Response(JSON.stringify({ meetings: [], next_page_token: "" }))
    },
    openBrowser: async () => {
      throw new Error("unexpected browser")
    },
    data: (text) => stdout.push(text),
    diagnostic: () => {},
  }
  const runsDir = join(directory, "state", "runs")
  const kept = async (): Promise<{ command: string; status: string; dir: string }[]> => {
    const days = await readdir(runsDir).catch(() => [])
    const runs = []
    for (const day of days)
      for (const entry of await readdir(join(runsDir, day), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const dir = join(runsDir, day, entry.name)
        runs.push({ ...JSON.parse(await readFile(join(dir, "run.json"), "utf8")), dir })
      }
    return runs
  }
  const listed = async () => {
    stdout.length = 0
    expect(await run(["runs", "list", "--limit", "5", "--page", "1", "--json"], deps)).toBe(0)
    return JSON.parse(stdout.join("")) as { items: { command: string; status: string; run_id: string }[] }
  }
  return { deps, env, stdout, requests, kept, listed }
}

it("keeps a failed command's run and lists it without a profile", async () => {
  const { deps, kept, listed } = await setup()
  expect(await run(["meetings", "list", "--json"], deps)).not.toBe(0)
  const [failed] = await kept()
  expect(failed).toMatchObject({ command: "meetings list", status: "failed" })
  expect(failed).not.toHaveProperty("profile")
  const answer = await listed()
  expect(answer.items).toMatchObject([{ command: "meetings list", status: "failed" }])
  expect(await kept()).toHaveLength(1)
})

it("keeps a usage error before any command without a profile", async () => {
  const { deps, kept } = await setup()
  expect(await run(["models", "--json"], deps)).not.toBe(0)
  const [failed] = await kept()
  expect(failed).toMatchObject({ command: "models", status: "failed" })
  expect(failed).not.toHaveProperty("profile")
})

it("keeps the failure of a config that will not load", async () => {
  const { deps, kept } = await setup()
  await writeFile(deps.configPath, "invalid")
  expect(await run(["example", "meetings", "list", "--json"], deps)).not.toBe(0)
  expect(await kept()).toMatchObject([{ command: "meetings list", status: "failed" }])
})

it("keeps a successful run only with --record or record in the config", async () => {
  const { deps, kept } = await setup()
  expect(await run(["config", "show", "--json"], deps)).toBe(0)
  expect(await kept()).toEqual([])
  expect(await run(["--record", "config", "show", "--json"], deps)).toBe(0)
  expect(await kept()).toMatchObject([{ command: "config show", status: "success" }])
  setConfig(deps.configPath, "record", "true")
  expect(await run(["config", "show", "--json"], deps)).toBe(0)
  expect(await kept()).toHaveLength(2)
})

it("keeps nothing with --no-record or record false, even on a failure", async () => {
  const { deps, kept } = await setup()
  expect(await run(["--no-record", "meetings", "list", "--json"], deps)).not.toBe(0)
  setConfig(deps.configPath, "record", "false")
  expect(await run(["meetings", "list", "--json"], deps)).not.toBe(0)
  expect(await kept()).toEqual([])
})

it("logs each Zoom request's masked operation, status and duration, and the answer names its run", async () => {
  const { deps, stdout, requests, kept, listed } = await setup()
  setConfig(deps.configPath, "zoom.client_id", "example-client")
  useProfile(deps.configPath, TEST_PROFILE, deps.env)
  deps.tokens.forProfile(TEST_PROFILE).save({
    accessToken: "example-access",
    refreshToken: "example-refresh",
    expiresAt: Number.MAX_SAFE_INTEGER,
    scopes: ["meeting:read:list_meetings"],
  })
  expect(await run(["--record", "--json", "remote-meetings", "list"], deps)).toBe(0)
  expect(requests).toHaveLength(1)
  const answerRun = JSON.parse(stdout.join("")).meta.run_id
  const [recorded] = await kept()
  expect(recorded).toMatchObject({ command: "remote-meetings list", status: "success", profile: TEST_PROFILE })
  const events = (await readFile(join(recorded?.dir ?? "", "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  expect(events.map((event) => [event.body, event.attributes.operation, event.attributes.status])).toEqual([
    ["provider.request", "GET /v2/users/me/meetings", undefined],
    ["provider.response", "GET /v2/users/me/meetings", 200],
  ])
  expect(JSON.stringify(events)).not.toContain("example-access")
  const { items } = await listed()
  expect(items.map((item) => item.run_id)).toEqual([answerRun])

  stdout.length = 0
  expect(await run(["runs", "show", answerRun, "--json"], deps)).toBe(0)
  const shown = JSON.parse(stdout.join(""))
  expect(shown.item).toMatchObject({ command: "remote-meetings list", event_count: 2 })
  expect(declaredAnswerIssue(createProgram(deps), "runs show", shown)).toBeUndefined()

  stdout.length = 0
  expect(await run(["runs", "show", answerRun, "--problems", "--json"], deps)).toBe(0)
  expect(JSON.parse(stdout.join("")).item.events).toEqual([])
  stdout.length = 0
  expect(await run(["runs", "path", answerRun, "--json"], deps)).toBe(0)
  expect(JSON.parse(stdout.join("")).item.path).toBe(recorded?.dir)
})

it("keeps a request that never got an answer as an error response in the failed run", async () => {
  const { deps, kept } = await setup()
  setConfig(deps.configPath, "zoom.client_id", "example-client")
  useProfile(deps.configPath, TEST_PROFILE, deps.env)
  deps.tokens.forProfile(TEST_PROFILE).save({
    accessToken: "example-access",
    refreshToken: "example-refresh",
    expiresAt: Number.MAX_SAFE_INTEGER,
    scopes: ["meeting:read:list_meetings"],
  })
  deps.fetch = async () => {
    throw new TypeError("fetch failed")
  }
  expect(await run(["--json", "remote-meetings", "list"], deps)).not.toBe(0)
  const [failed] = await kept()
  expect(failed).toMatchObject({ command: "remote-meetings list", status: "failed", kept_because_failed: true })
  const events = (await readFile(join(failed?.dir ?? "", "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  expect(events.at(-1)?.attributes).toMatchObject({ outcome: "error", error_code: "network_error" })
})

it("masks every path segment that is not a fixed word, and drops the host and query", () => {
  expect(operationOf("get", "https://api.zoom.us/v2/users/someone@example.com/recordings?from=2026-01-01")).toBe(
    "GET /v2/users/:id/recordings",
  )
  expect(operationOf("GET", "https://api.zoom.us/v2/past_meetings/aB3%2F%2Fxy==/participants")).toBe(
    "GET /v2/past_meetings/:id/participants",
  )
  expect(operationOf("GET", "https://example.zoom.us/rec/download/AbC-123_xyz.token?access_token=secret")).toBe(
    "GET /rec/download/:id",
  )
  expect(operationOf("PATCH", "https://api.zoom.us/v2/meetings/85746065432")).toBe("PATCH /v2/meetings/:id")
  expect(operationOf("POST", "https://zoom.us/oauth/token")).toBe("POST /oauth/token")
  expect(operationOf("GET", "not a url")).toBe("GET :url")
})

it("sets record and keep_runs_for_days in the config and keeps them across other settings", async () => {
  const { deps } = await setup()
  setConfig(deps.configPath, "record", "true")
  setConfig(deps.configPath, "keep_runs_for_days", "14")
  setConfig(deps.configPath, "source", "files")
  expect(readConfig(deps.configPath)).toMatchObject({ record: true, keepRunsForDays: 14, source: "files" })
  expect(() => setConfig(deps.configPath, "keep_runs_for_days", "0")).toThrow(/whole number/)
  expect(() => setConfig(deps.configPath, "record", "yes")).toThrow(/true or false/)
})

it("opens the token run log without a profile", async () => {
  const runsDir = await mkdtemp(join(tmpdir(), "zm-test-token-runs-"))
  const tokenRun = lazyRunLog({ runsDir, command: "oauth token", version: "0.0.0", allow: [] })
  tokenRun.log.info({ event: "token.refresh" })
  await tokenRun.finish("success")
  const [day] = await readdir(runsDir)
  const [entry] = await readdir(join(runsDir, day ?? ""))
  const recorded = JSON.parse(await readFile(join(runsDir, day ?? "", entry ?? "", "run.json"), "utf8"))
  expect(recorded).toMatchObject({ command: "oauth token", status: "success" })
  expect(recorded).not.toHaveProperty("profile")
})
