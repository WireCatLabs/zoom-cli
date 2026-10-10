import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, "../..")
const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"))
const errors = []

for (const [name, expected] of Object.entries(manifest.files)) {
  const actual = createHash("sha256")
    .update(readFileSync(resolve(directory, name)))
    .digest("hex")
  if (actual !== expected) errors.push(`Managed standard changed: ${name}`)
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
for (const [name, expected] of Object.entries(manifest.devDependencies)) {
  if (packageJson.devDependencies?.[name] !== expected) errors.push(`Expected ${name}@${expected}`)
}
if (packageJson.packageManager !== manifest.packageManager) errors.push("Package manager differs from shared standard")

const biome = JSON.parse(readFileSync(resolve(root, "biome.json"), "utf8"))
if (!biome.extends?.includes("./config/wirecat/biome.base.json"))
  errors.push("Biome does not extend the shared standard")
const spell = JSON.parse(readFileSync(resolve(root, "cspell.json"), "utf8"))
if (!spell.import?.includes("./config/wirecat/cspell.json")) errors.push("CSpell does not import the shared standard")
const markdown = JSON.parse(readFileSync(resolve(root, ".markdownlint-cli2.jsonc"), "utf8"))
if (markdown.config?.extends !== "./config/wirecat/markdownlint.json")
  errors.push("Markdown does not extend the shared standard")
const hooks = readFileSync(resolve(root, "lefthook.yml"), "utf8")
if (!/^\s*-\s*config\/wirecat\/lefthook\.yml\s*$/m.test(hooks))
  errors.push("Git hooks do not extend the shared standard")

if (errors.length) {
  process.stderr.write(`${errors.join("\n")}\nUpdate standards centrally or put project overrides in root configs.\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Shared standards match ${manifest.revision}.\n`)
}
