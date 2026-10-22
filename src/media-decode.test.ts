import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { expect, it } from "vitest"
import { wavFor } from "./media-decode.js"

const ffmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()

const wav = (rate: number) => {
  const bytes = Buffer.alloc(44 + 3200)
  bytes.write("RIFF", 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write("WAVEfmt ", 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(rate, 24)
  bytes.writeUInt32LE(rate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write("data", 36)
  bytes.writeUInt32LE(3200, 40)
  return bytes
}

it("passes a ready WAV through untouched, without ffmpeg", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "zm-test-decode-")), "ready.wav")
  await writeFile(path, wav(16000))
  const audio = await wavFor(path, { ffmpeg: "/nonexistent/ffmpeg" })
  expect(audio).toMatchObject({ path, decoded: false })
})

it("says ffmpeg is needed when a recording is not a ready WAV, and installs nothing", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "zm-test-decode-")), "odd.wav")
  await writeFile(path, wav(44100))
  await expect(wavFor(path, { ffmpeg: "/nonexistent/ffmpeg" })).rejects.toMatchObject({
    code: "configuration_error",
    message: expect.stringContaining("needs ffmpeg"),
  })
})

it.skipIf(!ffmpeg)("decodes a recording to the same PCM16 WAV every time, in a folder it removes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-decode-"))
  const input = join(directory, "example.m4a")
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", input])
  const first = await wavFor(input)
  const bytes = await readFile(first.path)
  expect(first.decoded).toBe(true)
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF")
  expect(bytes.readUInt32LE(24)).toBe(16000)
  await first.release()
  expect(existsSync(dirname(first.path))).toBe(false)
  const second = await wavFor(input)
  expect(await readFile(second.path)).toEqual(bytes)
  await second.release()
})

it("refuses a file that is not there", async () => {
  await expect(wavFor(join(tmpdir(), "zm-missing-example.m4a"))).rejects.toMatchObject({ code: "not_found" })
})
