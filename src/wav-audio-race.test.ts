import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import { preflightWavAudio } from "./wav-audio.js"

const race = vi.hoisted(() => ({ path: "", mode: "" as "" | "grow" | "metadata" | "truncate" }))
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      if (args[0] !== race.path) return handle
      return new Proxy(handle, {
        get(target, key) {
          if (key === "read")
            return async (...params: Parameters<typeof handle.read>) => {
              const desired = race.mode
              if (desired === "truncate" || (params[2] === 65536 && params[3] === 0)) {
                race.mode = ""
                if (desired === "grow") await fs.appendFile(race.path, Buffer.from([0]))
                if (desired === "metadata") await fs.utimes(race.path, new Date(1000), new Date(1000))
                if (desired === "truncate") await fs.truncate(race.path, 0)
              }
              return target.read(...params)
            }
          const value: unknown = Reflect.get(target, key, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    },
  }
})
it.each(["grow", "metadata", "truncate"] as const)(
  "refuses a WAV changed during bounded preflight: %s",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "zm-test-wave-race-"))
    const bytes = Buffer.alloc(44 + 16000 * 2 * 3)
    bytes.write("RIFF", 0)
    bytes.writeUInt32LE(bytes.length - 8, 4)
    bytes.write("WAVEfmt ", 8)
    bytes.writeUInt32LE(16, 16)
    bytes.writeUInt16LE(1, 20)
    bytes.writeUInt16LE(1, 22)
    bytes.writeUInt32LE(16000, 24)
    bytes.writeUInt32LE(32000, 28)
    bytes.writeUInt16LE(2, 32)
    bytes.writeUInt16LE(16, 34)
    bytes.write("data", 36)
    bytes.writeUInt32LE(bytes.length - 44, 40)
    race.path = join(root, "AliceExample.wav")
    await writeFile(race.path, bytes)
    race.mode = mode
    try {
      await expect(preflightWavAudio(race.path, { maxBytes: 1024 ** 2, maxDurationMs: 60000 })).rejects.toMatchObject({
        code: "validation_error",
      })
    } finally {
      race.mode = ""
    }
  },
)
