import { fileURLToPath } from "node:url"
import { packageVersion, packContents, releaseCheck } from "@wirecat/cli-base/release"

const root = fileURLToPath(new URL("..", import.meta.url))
const PACKED = ["dist/", "package.json", "README.md", "LICENSE", "skills/zoom-cli/SKILL.md", "scenarios/"]
const PACKED_SAID = "dist/, package.json, README.md, LICENSE, the agent skill and the guide scenarios"

const failed = releaseCheck([{ name: "package contents", run: packContents(root, PACKED, PACKED_SAID) }], {
  version: packageVersion(root),
  log: console.log,
})
process.exit(failed === 0 ? 0 : 1)
