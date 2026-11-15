import { memoryKeyring } from "@wirecat/cli-base"
import { expect, it } from "vitest"
import { ZoomApiSource } from "./api.js"
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
const zoom = (requests: string[] = []) =>
  new ZoomApiSource(tokens(), async (input) => {
    const url = new URL(String(input))
    requests.push(url.pathname)
    if (url.pathname.endsWith("/users/me/meetings")) return response({ meetings: [series], next_page_token: "" })
    if (url.pathname.endsWith("/instances")) return response({ meetings: ran })
    if (url.pathname.endsWith("/participants")) return response({ participants: [], next_page_token: "" })
    if (url.pathname.endsWith("/transcript"))
      return response({ can_download: false, download_restriction_reason: "NOT_READY" })
    const latest = url.pathname.endsWith("/past_meetings/123456789")
    return response({ ...series, ...(latest ? ran[1] : ran[0]), duration: 30 })
  })

it("names a run by its instance uuid in sync, find and get, whether asked by uuid or by meeting number", async () => {
  const source = zoom()
  const synced = (await source.meetings("2026-10-01T00:00:00Z")).map((meeting) => meeting.occurrence.id)
  const found = await source.find({ from: Date.parse("2026-10-01T00:00:00Z") }, [], null)
  expect(synced).toEqual(["first/run==", "second-run=="])
  expect(found.meetings.map(({ meeting }) => meeting.occurrence.id)).toEqual(synced)
  expect((await source.get("first/run=="))?.meeting.occurrence.id).toBe("first/run==")
  expect((await source.get("123456789"))?.meeting.occurrence.id).toBe("second-run==")
})

it("leaves the stored series alone on get, since a past meeting's answer has no join link or recurrence", async () => {
  expect((await zoom().get("first/run=="))?.meeting.series).toBeNull()
})

it("reads one page of series and one instance list per series for each find page", async () => {
  const requests: string[] = []
  const found = await zoom(requests).find({ from: Date.parse("2026-10-10T00:00:00Z") }, [], null)
  expect(found).toMatchObject({ next: null, meetings: [{ meeting: { occurrence: { id: "second-run==" } } }] })
  expect(requests).toEqual(["/v2/users/me/meetings", "/v2/past_meetings/123456789/instances"])
})

it("refuses get without the past-meeting scope, and answers null for a meeting that never ran", async () => {
  const refused = new ZoomApiSource(tokens(READS), async () => {
    throw new Error("unexpected request")
  })
  await expect(refused.get("123456789")).rejects.toMatchObject({ code: "permission_error" })
  const absent = new ZoomApiSource(tokens(), async () => response({ code: 3001, message: "absent" }, 404))
  expect(await absent.get("123456789")).toBeNull()
})
