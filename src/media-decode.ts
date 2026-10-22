import { execFile } from "node:child_process"
import { mkdtemp, open, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CliError } from "@wirecat/cli-base"

/** A WAV the recognizer reads as it is: PCM16, mono or stereo, at 16 or 48 kHz; anything else is decoded. */
const readyWav = async (file: string): Promise<boolean> => {
  const handle = await open(file, "r").catch(() => {
    throw new CliError("not_found", "the audio or video file could not be opened")
  })
  try {
    const head = Buffer.alloc(4096)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    if (bytesRead < 12 || head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE")
      return false
    for (let at = 12; at + 8 <= bytesRead; at += 8 + head.readUInt32LE(at + 4) + (head.readUInt32LE(at + 4) % 2)) {
      if (head.toString("ascii", at, at + 4) !== "fmt " || at + 24 > bytesRead) continue
      const format = head.readUInt16LE(at + 8)
      const channels = head.readUInt16LE(at + 10)
      const rate = head.readUInt32LE(at + 12)
      const bits = head.readUInt16LE(at + 22)
      return format === 1 && bits === 16 && (channels === 1 || channels === 2) && (rate === 16000 || rate === 48000)
    }
    return false
  } finally {
    await handle.close()
  }
}

/**
 * The file as PCM16 WAV, the one input the recognizer reads: a ready WAV as it is, anything else — a Zoom MP4 or
 * M4A, a 44.1 kHz WAV — decoded by the ffmpeg installed on this computer into a private temporary folder. The same input
 * decodes to the same bytes (bit-exact, no metadata), so a repeated transcription is recognised as a replay.
 */
export const wavFor = async (
  file: string,
  options: { signal?: AbortSignal; ffmpeg?: string } = {},
): Promise<{ path: string; decoded: boolean; release: () => Promise<void> }> => {
  if (await readyWav(file)) return { path: file, decoded: false, release: async () => {} }
  const directory = await mkdtemp(join(tmpdir(), "zm-decode-"))
  const release = () => rm(directory, { recursive: true, force: true })
  const path = join(directory, "audio.wav")
  const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000"]
  args.push("-c:a", "pcm_s16le", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-map_metadata", "-1", path)
  try {
    await new Promise<void>((resolve, reject) =>
      execFile(
        options.ffmpeg ?? "ffmpeg",
        args,
        { signal: options.signal, maxBuffer: 1024 * 1024 },
        (error, _out, err) => {
          if (!error) return resolve()
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return reject(
              new CliError(
                "configuration_error",
                "decoding a recording that is not WAV needs ffmpeg on PATH; zm does not install it",
              ),
            )
          if (options.signal?.aborted) return reject(new CliError("cancelled", "decoding was cancelled"))
          reject(
            new CliError("validation_error", `ffmpeg could not decode the file: ${String(err).trim().slice(0, 300)}`),
          )
        },
      ),
    )
    return { path, decoded: true, release }
  } catch (error) {
    await release()
    throw error
  }
}
