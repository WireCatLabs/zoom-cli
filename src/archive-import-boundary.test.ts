import { expect, it, vi } from "vitest"
import { preflightArchiveImport } from "./archive-import.js"

const mocked = vi.hoisted(() => ({ startedAt: null as string | null }))
vi.mock("./archive-transcripts.js", () => ({
  readArchiveTranscripts: async function* () {
    yield {
      meeting: { id: "123456", uuid: "example-occurrence", title: "Example", startedAt: mocked.startedAt },
      asset: {
        id: "example-asset",
        path: "example.vtt",
        size: 1,
        sha256: "example-hash",
        remoteSize: null,
        type: "audio_transcript",
        format: "vtt",
        startedAt: null,
        endedAt: null,
      },
      cues: [{ startMs: 0, endMs: 1000, speaker: "Alice Example", text: "Example" }],
    }
  },
}))
it("independently rejects non-null malformed or normalized-overflow occurrence starts before returning a plan", async () => {
  for (const startedAt of ["", "not-ISO", "2026-02-30T00:00:00.000Z", "+999999-01-01T00:00:00.000Z"]) {
    mocked.startedAt = startedAt
    await expect(preflightArchiveImport("example-directory")).rejects.toMatchObject({
      code: "validation_error",
      message: expect.stringContaining("ISO timestamp"),
    })
  }
  mocked.startedAt = null
  expect((await preflightArchiveImport("example-directory")).occurrences).toBe(1)
})
