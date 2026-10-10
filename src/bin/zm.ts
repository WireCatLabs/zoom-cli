#!/usr/bin/env node
import { spawn } from "node:child_process"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { resolvePaths, systemKeyring } from "@wirecat/cli-core"
import { readConfig } from "../config.js"
import { run } from "../program.js"
import { createStoreConnector } from "../store-connection.js"
import { TokenManager } from "../tokens.js"

const paths = resolvePaths({ appName: "zm", env: process.env })
const configPath = join(paths.config, "config.json")
try {
  const tokens = new TokenManager({
    get clientId() {
      return readConfig(configPath).clientId ?? ""
    },
    keyring: systemKeyring,
    service: `zoom-cli:${paths.config}`,
    fetch,
  })
  process.exitCode = await run(process.argv.slice(2), {
    configPath,
    tokens,
    fetch,
    connectStore: createStoreConnector({ env: process.env }),
    data: (text) => process.stdout.write(text),
    diagnostic: (text) => process.stderr.write(text),
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
}
