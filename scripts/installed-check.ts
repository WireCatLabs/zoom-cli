/**
 * The release's installed-package proof on this machine only, for pull requests: packs the built `dist`, installs
 * the tarball in a fresh directory and runs `installed-platform.mjs` against it. Release validation still runs the
 * same proof on Linux, macOS and Windows with Node 22 and 24 (ci.yml, installed-platforms).
 *
 *   pnpm build && pnpm installed:check
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }
const directory = mkdtempSync(join(tmpdir(), "zm-installed-check-"))
const installed = join(directory, "installed")
// Empty npm configs: the owner's ~/.npmrc must not change what is installed.
const npmEnvironment = {
  ...process.env,
  npm_config_userconfig: join(directory, "npmrc"),
  npm_config_globalconfig: join(directory, "npm-globalrc"),
  npm_config_registry: "https://registry.npmjs.org/",
}
writeFileSync(join(directory, "npmrc"), "")
writeFileSync(join(directory, "npm-globalrc"), "")
mkdirSync(installed)
writeFileSync(join(installed, "package.json"), '{"private":true,"type":"module"}\n')

const packed = JSON.parse(
  execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", directory], {
    cwd: root,
    encoding: "utf8",
    env: npmEnvironment,
  }),
) as { filename: string }[]
const tarball = packed[0]?.filename
if (!tarball) throw new Error("npm pack did not return a tarball")
execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(directory, tarball)], {
  cwd: installed,
  stdio: ["ignore", "ignore", "inherit"],
  env: npmEnvironment,
})
execFileSync(process.execPath, [join(root, "scripts", "installed-platform.mjs"), installed, version], {
  stdio: ["ignore", "ignore", "inherit"],
})
process.stdout.write(`installed package ${version}: proof passed (${installed})\n`)
