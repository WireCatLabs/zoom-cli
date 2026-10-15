import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export default function setup(): void {
  const path = join(process.cwd(), "coverage", "argv.jsonl")
  mkdirSync(join(process.cwd(), "coverage"), { recursive: true })
  if (existsSync(path)) copyFileSync(path, join(process.cwd(), "coverage", "argv.previous.jsonl"))
  writeFileSync(path, "")
  process.env.ZM_TEST_ARGV_LOG = path
}
