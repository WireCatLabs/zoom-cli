import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export default function setup(): void {
  const directory = mkdtempSync(join(tmpdir(), "zm-test-command-trace-"))
  const path = join(process.cwd(), "coverage", "argv.jsonl")
  mkdirSync(join(process.cwd(), "coverage"), { recursive: true })
  if (existsSync(path)) copyFileSync(path, join(directory, "previous.jsonl"))
  writeFileSync(path, "")
  process.env.ZM_TEST_ARGV_LOG = path
}
