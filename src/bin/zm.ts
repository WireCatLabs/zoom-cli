#!/usr/bin/env node
import { spawn } from "node:child_process"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { fileURLToPath } from "node:url"
import { CliError, systemKeyring } from "@wirecat/cli-base"
import { profileAccountKey, readConfig } from "../config.js"
import { ZoomError } from "../errors.js"
import { loginService, zmPaths } from "../folders.js"
import { writeExportFile } from "../output-file.js"
import { run } from "../program.js"
import { createStoreConnector } from "../store-connection.js"
import { writeStream } from "../streaming.js"
import { TokenManager } from "../tokens.js"

const paths = zmPaths(systemKeyring, (line) => process.stderr.write(line))
const configPath = join(paths.config, "config.json")
const cancellation = new AbortController()
let brokenPipe = false
const cancel = () => cancellation.abort(new CliError("cancelled", "command cancelled"))
const onPipeError = (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") {
    brokenPipe = true
    cancellation.abort(new CliError("cancelled", "output pipe closed"))
    process.exitCode = 0
  } else {
    cancellation.abort(new CliError("configuration_error", "could not write command output"))
    process.exitCode = 3
  }
}
process.once("SIGINT", cancel)
process.once("SIGTERM", cancel)
process.stdout.on("error", onPipeError)
try {
  const connectStore = createStoreConnector({ env: process.env })
  const tokens = new TokenManager({
    get clientId() {
      return readConfig(configPath).clientId ?? ""
    },
    keyring: systemKeyring,
    service: loginService(paths.config),
    fetch,
  })
  process.exitCode = await run(process.argv.slice(2), {
    configPath,
    recordingScheduleTarget: { runtime: process.execPath, cliPath: fileURLToPath(import.meta.url) },
    tokens,
    connectStore,
    serveMcp: async (options) => {
      const { serveMeetingMcp } = await import("../mcp-server.js")
      let profileCaptured = false
      let profile: string | null | undefined
      await serveMeetingMcp({
        ...options,
        connectStore: async () => {
          if (!profileCaptured) {
            profile = readConfig(configPath).accountProfile
            profileCaptured = true
          }
          if (!profile)
            throw new ZoomError(
              "configuration_error",
              "select a local profile with zm config set account.profile <label>",
            )
          return connectStore({ profile, externalId: profileAccountKey(profile), intent: "read" })
        },
      })
    },
    fetch,
    interactive: Boolean(process.stdin.isTTY),
    outputIsTTY: Boolean(process.stdout.isTTY),
    env: process.env,
    signal: cancellation.signal,
    writeFile: writeExportFile,
    streamData: (text, signal) => writeStream(process.stdout, text, signal),
    data: (text) => process.stdout.write(text),
    diagnostic: (text) => {
      if (!brokenPipe) process.stderr.write(text)
    },
    openBrowser: (url, browser = "xdg-open") =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(browser, [url], { detached: true, stdio: "ignore" })
        child.once("error", reject)
        child.once("spawn", () => {
          child.unref()
          resolve()
        })
      }),
    readPaste: process.stdin.isTTY
      ? async (signal) => {
          const input = createInterface({ input: process.stdin, output: process.stderr })
          try {
            return await input.question("If the callback does not complete, paste code=…&state=… here: ", { signal })
          } finally {
            input.close()
          }
        }
      : undefined,
  })
} catch {
  process.stderr.write(
    `${JSON.stringify({ error: { code: "configuration_error", message: "could not load zm configuration" } })}\n`,
  )
  process.exitCode = 3
} finally {
  process.removeListener("SIGINT", cancel)
  process.removeListener("SIGTERM", cancel)
  if (brokenPipe) process.exitCode = 0
}
