import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-core"
import { createProgram as zoomProgram } from "../dist/program.js"
import { TokenManager } from "../dist/tokens.js"

const unavailable = async (): Promise<never> => {
  throw new Error("Command discovery cannot perform external IO")
}

export const createProgram = () =>
  zoomProgram({
    configPath: join(tmpdir(), "zm-command-discovery", "config.json"),
    tokens: new TokenManager({
      clientId: "example-client",
      keyring: memoryKeyring(),
      service: "example",
      fetch: unavailable,
    }),
    fetch: unavailable,
    openBrowser: unavailable,
    data: () => {},
    diagnostic: () => {},
  })
