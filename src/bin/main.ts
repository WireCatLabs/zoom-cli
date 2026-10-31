import { createReadStream } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { addAbortSignal } from "node:stream"
import { fileURLToPath } from "node:url"
import {
  CliError,
  errorObjectOf,
  exitCodeOfError,
  isCliError,
  readBatchInput,
  renderError,
  systemKeyring,
} from "@wirecat/cli-base"
import { startCli } from "@wirecat/cli-core/cli/start"
import { ZM } from "../identity.js"
import { VERSION } from "../version.js"

let answerPolicy: typeof import("../answer-policy.js") | undefined
await startCli({
  app: ZM,
  run: async (entry) => {
    // These load cli-core's command tree, which a bare --version never needs.
    answerPolicy = await import("../answer-policy.js")
    const [
      { runsDirFor },
      { readConfig },
      { loginService, zmPaths },
      { writeExportFile },
      { run },
      { lazyRunLog },
      { createStoreConnector },
      { writeStream },
      { TOKEN_LOG_ALLOW, TokenManager },
    ] = await Promise.all([
      import("@wirecat/cli-core/cli"),
      import("../config.js"),
      import("../folders.js"),
      import("../output-file.js"),
      import("../program.js"),
      import("../run-log.js"),
      import("../store-connection.js"),
      import("../streaming.js"),
      import("../tokens.js"),
    ])
    const paths = zmPaths()
    const configPath = join(paths.config, "config.json")
    const tokenRun = lazyRunLog({
      runsDir: runsDirFor(ZM, entry.env),
      command: "oauth token",
      version: VERSION,
      allow: TOKEN_LOG_ALLOW,
    })
    let failed = true
    try {
      const tokens = new TokenManager({
        get clientId() {
          return readConfig(configPath).clientId ?? ""
        },
        keyring: systemKeyring,
        service: loginService(paths.config),
        configDir: paths.config,
        fetch,
        log: tokenRun.log,
      })
      const code = await run(entry.args, {
        configPath,
        recordingScheduleTarget: { runtime: process.execPath, cliPath: fileURLToPath(import.meta.url) },
        tokens,
        connectStore: createStoreConnector({ env: entry.env }),
        fetch,
        outputIsTTY: entry.tty,
        env: entry.env,
        signal: entry.signal,
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
          if (!entry.outputClosed()) process.stderr.write(text)
        },
        openBrowser: entry.openBrowser,
        // entry.ask answers no without asking when stdout is not a terminal; leaving confirm out then says to add --yes.
        confirm:
          entry.tty && process.stdin.isTTY && process.stderr.isTTY ? (question) => entry.ask(question) : undefined,
        atStart: entry.atStart,
        readPaste: process.stdin.isTTY
          ? async (signal) => {
              const input = createInterface({ input: process.stdin, output: process.stderr })
              try {
                return await input.question("If the callback does not complete, paste code=…&state=… here: ", {
                  signal,
                })
              } finally {
                input.close()
              }
            }
          : undefined,
      })
      failed = code !== 0
      return code
    } finally {
      await tokenRun.finish(failed ? "failed" : "success").catch(() => {})
    }
  },
  fail: (error, entry) => {
    const diagnostic = (text: string) => process.stderr.write(text)
    if (answerPolicy) return answerPolicy.reportFailure(error, entry.args, { diagnostic, outputIsTTY: entry.tty })
    // Only when answer-policy.js itself could not load.
    const object = errorObjectOf(error)
    diagnostic(`${renderError(object, { cli: ZM.command, interactive: entry.tty })}\n`)
    return exitCodeOfError(object)
  },
})
