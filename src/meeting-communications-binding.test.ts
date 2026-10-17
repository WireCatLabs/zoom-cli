import { expect, it, vi } from "vitest"
import type { ConfiguredContextSource } from "./context-sources.js"
import { type ContextMetadata, captureContextSources } from "./meeting-communications-binding.js"

const definition: ConfiguredContextSource = {
  id: "work",
  profile: "ResearchExample",
  kind: "message",
  provider: "example-messenger",
  account: "AliceExample",
}
const metadata = (): ContextMetadata => ({
  storedAccount: vi.fn<ContextMetadata["storedAccount"]>(async (key) => ({ ...key, id: 7, name: "Alice Example" })),
  accountById: vi.fn(async () => null),
})

it("captures only one profile and reuses detached identities across calls/concurrent resolution", async () => {
  const configured = [{ ...definition }, { ...definition, profile: "OtherExample", id: "other", account: "BobSample" }]
  const captured = captureContextSources(configured, "ResearchExample"),
    lookup = metadata(),
    foreign = metadata()
  if (!configured[0]) throw new Error("Missing fixture")
  configured[0].account = "changed"
  expect(captured.ids).toEqual(["work"])
  expect(() => captured.assert(["other"])).toThrow(/unauthorized/)
  const [first, second] = await Promise.all([captured.resolve(lookup), captured.resolve(foreign)])
  expect(first).toBe(second)
  expect(first).toEqual([
    { id: "work", source: { kind: "message", accountId: 7, provider: "example-messenger", account: "AliceExample" } },
  ])
  expect(lookup.storedAccount).toHaveBeenCalledOnce()
  expect(foreign.storedAccount).not.toHaveBeenCalled()
  expect(Object.isFrozen(first)).toBe(true)
  expect(Object.isFrozen(first[0]?.source)).toBe(true)
})

it("fails closed for missing configuration, foreign metadata and folder aliases, and can retry failed metadata resolution", async () => {
  expect(() => captureContextSources([], "ResearchExample").assert(["work"])).toThrow(/configure/)
  const lookup = metadata(),
    capture = captureContextSources([definition], "ResearchExample")
  vi.mocked(lookup.storedAccount).mockResolvedValueOnce({ provider: "foreign", account: "other", id: 7, name: null })
  await expect(capture.resolve(lookup)).rejects.toMatchObject({ code: "configuration_error" })
  expect(await capture.resolve(lookup)).toHaveLength(1)
  const folder = captureContextSources(
    [{ ...definition, kind: "document", provider: "folder", account: "notes:5" }],
    "ResearchExample",
  )
  await expect(folder.resolve(lookup)).rejects.toMatchObject({ code: "configuration_error" })
  vi.mocked(lookup.accountById).mockResolvedValue({ provider: "folder", account: "invented-folder-key" })
  await expect(folder.resolve(lookup)).rejects.toMatchObject({ code: "configuration_error" })
  vi.mocked(lookup.storedAccount).mockResolvedValueOnce({
    provider: "folder",
    account: "invented-folder-key",
    id: 5,
    name: null,
  })
  expect(await folder.resolve(lookup)).toMatchObject([
    { source: { kind: "document", provider: "folder", account: "invented-folder-key" } },
  ])
  expect(lookup.accountById).toHaveBeenCalledWith(5)
})
