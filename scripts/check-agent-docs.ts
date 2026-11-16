import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { withVersion } from "@wirecat/cli-base/skill"
import { validateSkill } from "@wirecat/cli-core/skill-validation"
import { VERSION } from "../dist/version.js"
import { createProgram } from "./command-program.ts"

// An agent carries SKILL.md in every turn of its session, so the core stays near 2,000 tokens (WC-DOC-22).
const MAX_SKILL_BYTES = 8_500

const file = new URL("../skills/zoom-cli/SKILL.md", import.meta.url)
const source = readFileSync(file, "utf8")
const program = createProgram()
assert.deepEqual(validateSkill(source, { folder: "zoom-cli", file: file.pathname, program }), [])
assert.deepEqual(validateSkill(withVersion(source, VERSION), { folder: "zoom-cli", version: VERSION, program }), [])
const size = Buffer.byteLength(source)
assert.ok(size <= MAX_SKILL_BYTES, `SKILL.md is ${size} bytes; move detail to references/ (at most ${MAX_SKILL_BYTES})`)

// validateSkill reads links and command paths only after frontmatter, so each reference borrows SKILL.md's.
const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(source)?.[0] ?? ""
const references = new URL("../skills/zoom-cli/references/", import.meta.url)
for (const name of readdirSync(references).filter((entry) => entry.endsWith(".md"))) {
  const reference = new URL(name, references)
  const text = frontmatter + readFileSync(reference, "utf8")
  assert.deepEqual(validateSkill(text, { file: reference.pathname, program }), [], `references/${name}`)
  assert.ok(source.includes(`](references/${name})`), `SKILL.md does not link references/${name}`)
}
process.stdout.write("skill, version and references: ok\n")
