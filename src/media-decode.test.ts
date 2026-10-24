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

it("says ffmpeg could not decode, and that a stopped run was cancelled", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-decode-"))
  const input = join(directory, "broken.m4a")
  await writeFile(input, "not audio")
  const failing = join(directory, "ffmpeg")
  await writeFile(failing, "#!/bin/sh\necho 'invented decoder failure' >&2\nexit 1\n", { mode: 0o755 })
  await expect(wavFor(input, { ffmpeg: failing })).rejects.toMatchObject({
    code: "validation_error",
    message: expect.stringContaining("invented decoder failure"),
  })
  const slow = join(directory, "slow-ffmpeg")
  await writeFile(slow, "#!/bin/sh\nsleep 5\n", { mode: 0o755 })
  const controller = new AbortController()
  const decoding = wavFor(input, { ffmpeg: slow, signal: controller.signal })
  controller.abort()
  await expect(decoding).rejects.toMatchObject({ code: "cancelled" })
})

it("finds the format after other chunks, as a WAV from an editor has them", async () => {
  const listed = wav(16000)
  const extra = Buffer.alloc(8 + 4)
  extra.write("LIST", 0)
  extra.writeUInt32LE(4, 4)
  extra.write("INFO", 8)
  const bytes = Buffer.concat([listed.subarray(0, 12), extra, listed.subarray(12)])
  bytes.writeUInt32LE(bytes.length - 8, 4)
  const path = join(await mkdtemp(join(tmpdir(), "zm-test-decode-")), "listed.wav")
  await writeFile(path, bytes)
  expect(await wavFor(path, { ffmpeg: "/nonexistent/ffmpeg" })).toMatchObject({ path, decoded: false })
})

it("releases a successful decoder's temporary output without touching its input, even when ffmpeg is unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zm-test-decoder-lifecycle-"))
  const input = join(directory, "input.m4a")
  const expected = wav(16000)
  await writeFile(input, "invented decoder input")
  await writeFile(join(directory, "fixture.wav"), expected)
  const decoder = join(directory, "decoder")
  await writeFile(decoder, '#!/bin/sh\nfor output in "$@"; do :; done\ncp "$(dirname "$0")/fixture.wav" "$output"\n', {
    mode: 0o755,
  })
  const audio = await wavFor(input, { ffmpeg: decoder })
  expect(audio.decoded).toBe(true)
  expect(await readFile(audio.path)).toEqual(expected)
  expect(await readFile(input, "utf8")).toBe("invented decoder input")
  await audio.release()
  expect(existsSync(dirname(audio.path))).toBe(false)
  await audio.release()
})
