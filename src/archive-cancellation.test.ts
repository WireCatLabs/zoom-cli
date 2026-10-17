import { createHash } from "node:crypto"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { verifyArchive } from "./recording-manifest.js"

const opening = vi.hoisted(() => ({
  path: "",
  abort: undefined as (() => void) | undefined,
  closed: 0,
  streams: 0,
}))
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const file = await fs.open(...args)
      if (args[0] !== opening.path) return file
      // Abort after the real handle exists, before the awaited open returns it to the caller.
      opening.abort?.()
      return new Proxy(file, {
        get(target, key) {
          if (key === "close")
            return async () => {
              opening.closed++
              await target.close()
            }
          if (key === "createReadStream")
            return (...options: Parameters<typeof file.createReadStream>) => {
              opening.streams++
              return target.createReadStream(...options)
            }
          const value: unknown = Reflect.get(target, key, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    },
  }
})

it("closes the opened asset without creating an already-aborted verification stream", async () => {
  const root = await mkdtemp(join(tmpdir(), "zm-test-open-cancel-"))
  const digest = (text: string) => createHash("sha256").update(text).digest("hex")
  const uuid = "example-occurrence"
  const id = "example-asset"
  const content = "Example archive contents"
  const path = `${digest(uuid)}-${digest(id)}.txt`
  await writeFile(join(root, path), content)
  await writeFile(
    join(root, `.zoom-archive-${digest(uuid)}.json`),
    JSON.stringify({
      version: 1,
      meeting: { id: "123456", uuid, title: "Example", startedAt: null },
      files: [
        {
          id,
          path,
          size: Buffer.byteLength(content),
          sha256: digest(content),
          remoteSize: null,
          type: "chat_file",
          format: "txt",
          startedAt: null,
          endedAt: null,
        },
      ],
    }),
  )
  const controller = new AbortController()
  opening.path = join(root, path)
  opening.abort = () => controller.abort()
  try {
    await expect(verifyArchive(root, { signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" })
    expect(opening.closed).toBe(1)
    expect(opening.streams).toBe(0)
    await new Promise<void>((resolve) => setImmediate(resolve))
    opening.abort = undefined
    expect(await verifyArchive(root)).toMatchObject([{ valid: true }])
    expect(opening.closed).toBe(2)
    expect(opening.streams).toBe(1)
  } finally {
    opening.path = ""
    opening.abort = undefined
  }
})
