#!/usr/bin/env node
import { enableCompileCache } from "node:module"
import { wcatStart } from "@wirecat/cli-base/wcat/start"
import { ZM } from "../identity.js"

// Static imports would compile before this call; loading the program after it lets later runs reuse the cache.
enableCompileCache()
const wcat = await wcatStart({
  command: ZM.command,
  version: ZM.version,
  description: ZM.description,
  docs: "https://github.com/WireCatLabs/zoom-cli#readme",
})
if (wcat.code !== undefined) {
  process.exitCode = wcat.code
} else {
  await import("./main.js")
}
