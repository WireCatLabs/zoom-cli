import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll } from "vitest"

// Each test file owns this root, including temporary files made by its subprocesses.
const directory = mkdtempSync(join(tmpdir(), "zm-test-suite-"))
const keys = ["TMPDIR", "TMP", "TEMP"] as const
const previous = keys.map((key) => [key, process.env[key]] as const)
for (const key of keys) process.env[key] = directory

// Stack ordering runs this after hooks registered by the test file close their resources.
afterAll(() => {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})
