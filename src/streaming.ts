import type { Writable } from "node:stream"
import { CliError, createOutputBuffer } from "@wirecat/cli-base"
import { checkCancelled } from "./errors.js"

/** Await kernel-facing stdout backpressure before advancing another ingestion/download cycle. */
export const writeStream = (stream: Writable, text: string, signal: AbortSignal): Promise<void> => {
  checkCancelled(signal)
  return new Promise((resolve, reject) => {
    let settled = false
    let returned = false
    let callbackDone = false
    let needsDrain = false
    let drained = false
    let callbackFailed = false
    let errorObserved = false
    const outputError = () => new CliError("configuration_error", "could not write command output")
    const removeGuard = () => stream.removeListener("error", failed)
    const done = (error?: Error) => {
      if (settled) return
      settled = true
      stream.removeListener("drain", onDrain)
      signal.removeEventListener("abort", aborted)
      if (callbackDone && (!callbackFailed || errorObserved)) removeGuard()
      if (error) reject(error)
      else resolve()
    }
    const finish = () => {
      if (returned && callbackDone && (!needsDrain || drained)) done()
    }
    const onDrain = () => {
      drained = true
      finish()
    }
    const failed = () => {
      errorObserved = true
      done(outputError())
      if (callbackDone) removeGuard()
    }
    const aborted = () => {
      try {
        checkCancelled(signal)
      } catch (error) {
        done(error as Error)
      }
    }
    signal.addEventListener("abort", aborted, { once: true })
    // A submitted write can fail after cancellation. Keep this guard until its callback/error settles.
    stream.on("error", failed)
    stream.on("drain", onDrain)
    try {
      needsDrain = !stream.write(text, (error) => {
        callbackDone = true
        callbackFailed = Boolean(error)
        if (error) done(outputError())
        else finish()
        if (settled && (!callbackFailed || errorObserved)) removeGuard()
      })
      returned = true
      finish()
    } catch {
      callbackDone = true
      errorObserved = true
      done(outputError())
    }
  })
}

/** Bound each complete receipt, without retaining the foreground stream. */
export const emitReceipt = async (
  text: string,
  maxOutputBytes: number | undefined,
  write: (text: string) => Promise<void>,
): Promise<void> => {
  const output = createOutputBuffer({ maxOutputBytes })
  output.data(text)
  let serialized = ""
  output.flush((chunk) => {
    serialized += chunk
  })
  await write(serialized)
}
