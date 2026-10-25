import { createReadStream } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { addAbortSignal } from "node:stream"
import { fileURLToPath } from "node:url"
import { CliError, isCliError, readBatchInput, systemKeyring } from "@wirecat/cli-base"
import { runsDirFor, startCli } from "@wirecat/cli-core/cli"
import { reportFailure } from "../answer-policy.js"
import { readConfig } from "../config.js"
import { loginService, zmPaths } from "../folders.js"
import { writeExportFile } from "../output-file.js"
import { run } from "../program.js"
import { ZM } from "../read-only.js"
import { lazyRunLog } from "../run-log.js"
import { createStoreConnector } from "../store-connection.js"
import { writeStream } from "../streaming.js"
import { TOKEN_LOG_ALLOW, TokenManager } from "../tokens.js"
import { VERSION } from "../version.js"

await startCli({
  app: ZM,
  run: async (entry) => {
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
  fail: (error, entry) =>
    reportFailure(error, entry.args, { diagnostic: (text) => process.stderr.write(text), outputIsTTY: entry.tty }),
})
