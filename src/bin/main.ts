import { spawn } from "node:child_process"
import { createReadStream } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { addAbortSignal } from "node:stream"
import { fileURLToPath } from "node:url"
import { CliError, catchCrashes, isCliError, readBatchInput, systemKeyring } from "@wirecat/cli-base"
import { readOnlyLockOf, setupAtStart } from "@wirecat/cli-core/cli"
import { reportFailure } from "../answer-policy.js"
import { readConfig } from "../config.js"
import { loginService, zmPaths } from "../folders.js"
import { writeExportFile } from "../output-file.js"
import { pathOf } from "../permissions.js"
import { run } from "../program.js"
import { ZM } from "../read-only.js"
import { lazyRunLog } from "../run-log.js"
import { createStoreConnector } from "../store-connection.js"
import { writeStream } from "../streaming.js"
import { TOKEN_LOG_ALLOW, TokenManager } from "../tokens.js"
import { VERSION } from "../version.js"

const args = process.argv.slice(2)
const outputIsTTY = Boolean(process.stdout.isTTY)
const releaseCrashes = catchCrashes({ cli: "zm", interactive: outputIsTTY })
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
let tokenRun: ReturnType<typeof lazyRunLog> | undefined
try {
  const paths = zmPaths()
  const configPath = join(paths.config, "config.json")
  tokenRun = lazyRunLog({
    runsDir: join(paths.state, "runs"),
    command: "oauth token",
    version: VERSION,
    allow: TOKEN_LOG_ALLOW,
  })
  const connectStore = createStoreConnector({ env: process.env })
  const tokens = new TokenManager({
    get clientId() {
      return readConfig(configPath).clientId ?? ""
    },
    keyring: systemKeyring,
    service: loginService(paths.config),
    fetch,
    log: tokenRun.log,
  })
  process.exitCode = await run(args, {
    configPath,
    recordingScheduleTarget: { runtime: process.execPath, cliPath: fileURLToPath(import.meta.url) },
    tokens,
    connectStore,
    fetch,
    outputIsTTY,
    env: process.env,
    signal: cancellation.signal,
    writeFile: writeExportFile,
    readBatchInput: async (path, signal) => {
      signal?.throwIfAborted()
      const input = path === "-" ? process.stdin : createReadStream(path, { signal })
      if (signal && path === "-") addAbortSignal(signal, input)
      try {
        return await readBatchInput(input, { signal })
      } catch (error) {
        signal?.throwIfAborted()
        if (isCliError(error)) throw error
        throw new CliError("configuration_error", "could not read the batch input file or stdin")
      }
    },
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
    confirm:
      process.stdin.isTTY && process.stderr.isTTY
        ? async (question) => {
            const input = createInterface({ input: process.stdin, output: process.stderr })
            try {
              return /^y(es)?$/i.test((await input.question(`${question} [y/N] `)).trim())
            } finally {
              input.close()
            }
          }
        : undefined,
    atStart: (command) => {
      const given = command.optsWithGlobals()
      return setupAtStart({
        command: "zm",
        env: process.env,
        path: pathOf(command),
        headless: Boolean(given.json || given.jsonl || given.input === false || process.env.CI) || !outputIsTTY,
        readOnlyLock: readOnlyLockOf(ZM, process.env),
      })
    },
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
} catch (error) {
  process.exitCode = reportFailure(error, args, { diagnostic: (text) => process.stderr.write(text), outputIsTTY })
} finally {
  await tokenRun?.finish(process.exitCode ? "failed" : "success").catch(() => {})
  process.removeListener("SIGINT", cancel)
  process.removeListener("SIGTERM", cancel)
  if (brokenPipe) process.exitCode = 0
  releaseCrashes()
}
