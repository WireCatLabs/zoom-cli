import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

/** Keeps the operations zm calls out of Zoom's whole Chat API document (half a megabyte). */
const download = process.argv[2]
if (!download) throw new Error("usage: pnpm zoom:spec <downloaded zoom-chat-methods.json>")
const sourcePath = new URL("../../spec/zoom/source.json", import.meta.url)
const source = JSON.parse(readFileSync(sourcePath, "utf8")) as {
  sourceUrl: string
  revision: string
  fetchedAt: string
  operations: Record<string, string[]>
}
const raw = readFileSync(download)
const full = JSON.parse(raw.toString("utf8"))
const paths = Object.fromEntries(
  Object.entries(source.operations).map(([path, methods]) => {
    const item = full.paths?.[path]
    if (!item) throw new Error(`the download has no ${path}`)
    return [path, Object.fromEntries(methods.map((method) => [method, item[method]]))]
  }),
)
const trimmed = { openapi: full.openapi, info: full.info, servers: full.servers, paths }
writeFileSync(new URL("../../spec/zoom/chat.json", import.meta.url), `${JSON.stringify(trimmed, null, 2)}\n`)
source.revision = `sha256:${createHash("sha256").update(raw).digest("hex").slice(0, 16)}`
source.fetchedAt = new Date().toISOString().slice(0, 10)
writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`)
