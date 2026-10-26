import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

const IMPORT = /^(?:import|export)(?!\s+type\b)[^;]*?\sfrom\s+"([^"]+)"/gm
const DYNAMIC_IMPORT = /(?<!typeof )\bimport\("([^"]+)"\)/g

/** What loading `file` loads: its static imports, transitively, never `import type`. */
const loadedBy = (file: string, seen = new Set<string>(), packages = new Set<string>()) => {
  if (seen.has(file)) return packages
  seen.add(file)
  for (const [, from] of readFileSync(file, "utf8").matchAll(IMPORT)) {
    if (!from) continue
    if (from.startsWith(".")) loadedBy(join(dirname(file), from.replace(/\.js$/, ".ts")), seen, packages)
    else packages.add(from)
  }
  return packages
}

/** What the bin loads before `startCli` gets to answer a bare `--version`: everything above the call. */
const loadedAtStart = (bin: string) => {
  const head = readFileSync(bin, "utf8").split("await startCli(")[0] ?? ""
  const packages = new Set<string>()
  const specifiers = [...head.matchAll(IMPORT), ...head.matchAll(DYNAMIC_IMPORT)].map(([, from]) => from ?? "")
  for (const from of specifiers) {
    if (from.startsWith(".")) loadedBy(join(dirname(bin), from.replace(/\.js$/, ".ts")), new Set(), packages)
    else packages.add(from)
  }
  return packages
}

describe("starting zm", () => {
  it("**answers a bare --version without cli-core's command tree**: it was 1,100 of 1,150 files", () => {
    const packages = loadedAtStart(join(import.meta.dirname, "bin", "main.ts"))
    expect(packages).not.toContain("@wirecat/cli-core/cli")
    expect(packages).not.toContain("@wirecat/cli-core")
    expect(packages).toContain("@wirecat/cli-core/cli/start")
  })
})
