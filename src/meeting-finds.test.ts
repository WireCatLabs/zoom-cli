import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { memoryMeetingStore } from "@wirecat/cli-core/meetings/testing"
import { expect, it } from "vitest"
import { TEST_PROFILE, useProfile } from "../scripts/testing/profile.js"
import { ZoomApiSource } from "./api.js"
import { setConfig } from "./config.js"
import { run } from "./program.js"
import { TokenManager } from "./tokens.js"

const READS = [
  "meeting:read:list_meetings",
  "meeting:read:list_past_instances",
  "meeting:read:list_past_participants",
  "cloud_recording:read:meeting_transcript",
]
const tokens = (scopes = [...READS, "meeting:read:past_meeting"]) => {
  const manager = new TokenManager({
    clientId: "example-client",
    keyring: memoryKeyring(),
    service: "example",
    fetch,
    now: () => 0,
  })
  manager.save({ accessToken: "example-access", refreshToken: "example-refresh", expiresAt: 3600000, scopes })
  return manager
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const series = { id: 123456789, uuid: "series-uuid==", topic: "Example weekly", type: 8, timezone: "UTC" }
const ran = [
  { uuid: "first/run==", start_time: "2026-10-05T10:00:00Z", end_time: "2026-10-05T10:30:00Z" },
  { uuid: "second-run==", start_time: "2026-10-12T10:00:00Z", end_time: "2026-10-12T10:30:00Z" },
]
const at = (text: string) => Date.parse(text)
/** Zoom as its docs describe it, strictly: `from` and `to` come together, as whole days, and a page holds 300. */
const strict = (url: URL) => {
  const { searchParams: query } = url
  if (query.has("from") !== query.has("to")) throw new Error(`from without to: ${url}`)
  for (const key of ["from", "to"])
    if (query.has(key) && !/^\d{4}-\d{2}-\d{2}$/.test(query.get(key) ?? "")) throw new Error(`not a day: ${url}`)
  if (url.pathname.endsWith("/users/me/meetings") && query.has("from")) {
    if (query.get("timezone") !== "UTC") throw new Error(`no timezone: ${url}`)
    if (Number(query.get("page_size")) > 300) throw new Error(`page over 300: ${url}`)
  }
}
const zoom = (requests: string[] = [], list: (query: URLSearchParams) => unknown = () => ({ meetings: [series] })) =>
  new ZoomApiSource(tokens(), async (input) => {
    const url = new URL(String(input))
    strict(url)
    requests.push(`${url.pathname}${url.search}`)
    if (url.pathname.endsWith("/users/me/meetings"))
      return response({ next_page_token: "", ...(list(url.searchParams) as object) })
    if (url.pathname.endsWith("/instances")) return response({ meetings: ran })
    if (url.pathname.endsWith("/participants")) return response({ participants: [], next_page_token: "" })
    if (url.pathname.endsWith("/transcript"))
      return response({ can_download: false, download_restriction_reason: "NOT_READY" })
    const latest = url.pathname.endsWith("/past_meetings/123456789")
    return response({ ...series, ...(latest ? ran[1] : ran[0]), duration: 30 })
  })
const october = { from: at("2026-10-01T00:00:00Z"), to: at("2026-10-20T00:00:00Z") }

it("names a run by its instance uuid in sync, find and get, whether asked by uuid or by meeting number", async () => {
  const source = zoom()
  const synced = (await source.meetings("2026-10-01T00:00:00Z")).map((meeting) => meeting.occurrence.id)
  const found = await source.find(october, [], null)
  expect(synced).toEqual(["first/run==", "second-run=="])
  expect(found.meetings.map(({ meeting }) => meeting.occurrence.id)).toEqual(synced)
  expect((await source.get("first/run=="))?.meeting.occurrence.id).toBe("first/run==")
  expect((await source.get("123456789"))?.meeting.occurrence.id).toBe("second-run==")
})

it("leaves the stored series alone on get, since a past meeting's answer has no join link or recurrence", async () => {
  expect((await zoom().get("first/run=="))?.meeting.series).toBeNull()
})

it("asks Zoom for the window's days, 300 a page, and one instance list per series", async () => {
  const requests: string[] = []
  const found = await zoom(requests).find({ from: at("2026-10-10T00:00:00Z"), to: october.to }, [], null)
  expect(found).toMatchObject({ next: null, meetings: [{ meeting: { occurrence: { id: "second-run==" } } }] })
  expect(requests).toEqual([
    "/v2/users/me/meetings?type=previous_meetings&page_size=300&from=2026-10-10&to=2026-10-20&timezone=UTC",
    "/v2/past_meetings/123456789/instances?from=2026-10-10&to=2026-10-20",
  ])
})

it("reads at most 20 series' instances a call, and carries on in the same page", async () => {
  const many = Array.from({ length: 25 }, (_, n) => ({ ...series, id: 100000000 + n }))
  const requests: string[] = []
  const source = zoom(requests, () => ({ meetings: many }))
  const first = await source.find(october, [], null)
  expect(requests).toHaveLength(21)
  expect(first.next).not.toBeNull()
  requests.length = 0
  const second = await source.find(october, [], first.next)
  expect(requests).toHaveLength(6)
  expect(second.next).toBeNull()
})

it("walks a window wider than a month a month at a time, and without a start stops where Zoom's list ends", async () => {
  const days: string[] = []
  const source = zoom([], (query) => {
    days.push(`${query.get("from")}..${query.get("to")}`)
    return { meetings: [] }
  })
  let cursor: string | null = null
  let calls = 0
  do {
    cursor = (await source.find({ to: at("2026-11-15T00:00:00Z") }, [], cursor)).next
    calls++
  } while (cursor !== null && calls < 20)
  expect(days[0]).toBe("2026-10-16..2026-11-15")
  expect(calls).toBe(7)
  expect(days.at(-1)?.startsWith("2026-05-1")).toBe(true)
  await expect(source.find(october, [], "not a cursor")).rejects.toMatchObject({ code: "validation_error" })
})

it("refuses a from without a to, as Zoom does", () => {
  expect(() => strict(new URL("https://api.zoom.us/v2/users/me/meetings?from=2026-10-01"))).toThrow(/from without to/)
})

it("refuses get without the past-meeting scope, and answers null for a meeting that never ran", async () => {
  const refused = new ZoomApiSource(tokens(READS), async () => {
    throw new Error("unexpected request")
  })
  await expect(refused.get("123456789")).rejects.toMatchObject({ code: "permission_error" })
  const absent = new ZoomApiSource(tokens(), async () => response({ code: 3001, message: "absent" }, 404))
  expect(await absent.get("123456789")).toBeNull()
})

it("says a plain meetings list is not complete when Zoom has more stretches to read than one list asks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-finds-"))
  const stdout: string[] = []
  const requests: string[] = []
  const manager = tokens()
  const deps = {
    configPath: join(directory, "config.json"),
    env: { HOME: directory, ZM_STATE_DIR: join(directory, "state") },
    tokens: manager,
    fetch: async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      strict(url)
      requests.push(url.pathname)
      return response({ meetings: [], next_page_token: "" })
    },
    store: memoryMeetingStore(),
    accountId: 1,
    openBrowser: async () => {},
    data: (text: string) => stdout.push(text),
    diagnostic: () => {},
  }
  setConfig(deps.configPath, "zoom.client_id", "example-client")
  useProfile(deps.configPath, TEST_PROFILE, deps.env)
  manager.forProfile(TEST_PROFILE).save({
    accessToken: "example-access",
    refreshToken: "example-refresh",
    expiresAt: Number.MAX_SAFE_INTEGER,
    scopes: READS,
  })
  expect(await run(["meetings", "list", "--json"], deps)).toBe(0)
  const answer = JSON.parse(stdout.join(""))
  expect(answer.meta).toMatchObject({ complete: false, issues: [{ reason: "meetings.server-capped" }] })
  expect(requests.length).toBeLessThanOrEqual(3 * 2 * 21)
})
