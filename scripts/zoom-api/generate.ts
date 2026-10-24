import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { adaptOpenApi, generate, typesGenerator, valibotGenerator, writeArtifacts } from "@wirecat/cli-base/codegen"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"))
const provenance = read("spec/zoom/source.json")
const model = adaptOpenApi(read("spec/zoom/chat.json"), {
  sourceUrl: provenance.sourceUrl,
  sourceRevision: provenance.revision,
})
const artifacts = generate(
  model,
  [
    typesGenerator({ path: "src/zoom-api/types.ts" }),
    valibotGenerator({ path: "src/zoom-api/schemas.ts", typesImport: "./types.js" }),
  ],
  { banner: ["Source: spec/zoom/chat.json", "Run: pnpm zoom:generate"] },
)
const check = process.argv.includes("--check")
const stale = writeArtifacts(artifacts, {
  root,
  check,
  format: (path, content) =>
    execFileSync(
      process.execPath,
      [join(root, "node_modules/@biomejs/biome/bin/biome"), "format", "--write", `--stdin-file-path=${path}`],
      { input: content, encoding: "utf8", cwd: root },
    ),
})
if (check && stale.length) {
  process.stderr.write(`out of date — run pnpm zoom:generate:\n${stale.join("\n")}\n`)
  process.exit(1)
}
process.stderr.write(`${model.operations.length} operations, ${stale.length} files ${check ? "checked" : "written"}\n`)
