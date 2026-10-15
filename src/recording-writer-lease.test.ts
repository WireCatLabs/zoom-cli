import { existsSync, readdirSync, unlinkSync } from "node:fs"
import { mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { archiveRecording } from "./recording-archive.js"
import type { RecordingMeeting } from "./recordings.js"
import { ZoomRemote } from "./remote-http.js"

it("refuses an archive before downloading when its writer marker disappears during confirmation", async () => {
  const destination = await mkdtemp(join(tmpdir(), "zm-test-writer-confirmation-"))
  const folder = join(destination, ".zoom-archive-locks")
  const controller = new AbortController()
  let removed = false
  const check = vi.spyOn(controller.signal, "throwIfAborted").mockImplementation(() => {
    if (!removed && existsSync(folder)) {
      const [name] = readdirSync(folder)
      if (name) {
        unlinkSync(join(folder, name))
        removed = true
      }
    }
  })
  const fetcher = vi.fn(async () => new Response("abcdef", { headers: { "content-length": "6" } }))
  const remote = new ZoomRemote(
    {
      tokens: async () => ({
        accessToken: "example-access",
        refreshToken: "example-refresh",
        expiresAt: 3600000,
        scopes: [],
      }),
    },
    fetcher,
  )
  const meeting: RecordingMeeting = {
    id: "123456",
    uuid: "example-confirmation",
    title: "Example planning",
    startedAt: null,
    assets: [
      {
        id: "example-asset",
        type: "shared_screen",
        format: "MP4",
        size: 6,
        status: "completed",
        available: true,
        startedAt: null,
        endedAt: null,
      },
    ],
  }
  try {
    await expect(
      archiveRecording(remote, meeting, new Map([["example-asset", "https://zoom.us/example-recording"]]), {
        destination,
        account: "AliceExample",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "configuration_error" })
  } finally {
    check.mockRestore()
  }
  expect(removed).toBe(true)
  expect(fetcher).not.toHaveBeenCalled()
  expect(await readdir(destination)).toEqual([])
})
