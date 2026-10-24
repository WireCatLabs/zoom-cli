import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { packageVersion } from "@wirecat/cli-base/release"

export type ReleaseRunner = (command: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string) => string

const checks = [
  ["pnpm", "install", "--frozen-lockfile"],
  ...[
    "version:check",
    "standards:check",
    "lint",
    "typecheck",
    "test:coverage",
    "generate:check",
    "docs:check",
    "contracts:check",
    "contracts:upgrade",
    "security:no-leak",
    "test:matrix:check",
    "package:check",
    "smoke:bun",
  ].map((name) => ["pnpm", name]),
  ["gitleaks", "git", "--redact", "--no-banner"],
  ["zizmor", ".github/workflows"],
  ["npm", "audit", "--omit=dev", "--audit-level=high"],
] as const

export const localRelease = async (
  root: string,
  options: {
    env: NodeJS.ProcessEnv
    run: ReleaseRunner
    pause?: () => Promise<void>
    temporary?: string
  },
): Promise<void> => {
  const temporary = options.temporary ?? mkdtempSync(join(tmpdir(), "zm-local-release-"))
  mkdirSync(temporary, { recursive: true, mode: 0o700 })
  const emptyConfig = join(temporary, "checks.npmrc")
  const globalConfig = join(temporary, "global.npmrc")
  writeFileSync(emptyConfig, "", { mode: 0o600 })
  writeFileSync(globalConfig, "", { mode: 0o600 })
  const environment: NodeJS.ProcessEnv = {
    ...Object.fromEntries(
      Object.entries(options.env).filter(([key]) => !/TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)),
    ),
    NPM_CONFIG_USERCONFIG: emptyConfig,
    NPM_CONFIG_GLOBALCONFIG: globalConfig,
  }
  const run = (command: string, args: readonly string[], cwd = root) => options.run(command, args, environment, cwd)
  const version = packageVersion(root)
  const dated = readFileSync(join(root, "CHANGELOG.md"), "utf8")
    .split("\n")
    .find((line) => line.startsWith("## "))
  if (!dated?.startsWith(`## ${version} — `)) throw new Error("date the top changelog section before releasing locally")
  const versions = JSON.parse(
    run("npm", ["view", "@wirecat/zoom-cli", "versions", "--json", "--prefer-online"]),
  ) as unknown
  if (!Array.isArray(versions) || versions.includes(version))
    throw new Error("the package version is already published or npm returned no version list")
  const commit = run("git", ["rev-parse", "HEAD"]).trim()
  const main = run("git", ["rev-parse", "origin/main"]).trim()
  if (
    commit !== main ||
    run("git", ["branch", "--show-current"]).trim() !== "main" ||
    run("git", ["status", "--porcelain"]).trim()
  )
    throw new Error("local release requires a clean main equal to origin/main")
  for (const [command, ...args] of checks) run(command, args)
  const database = join(temporary, "codeql")
  const sarif = join(temporary, "codeql.sarif")
  run("codeql", [
    "database",
    "create",
    database,
    "--language=javascript-typescript",
    "--build-mode=none",
    `--source-root=${root}`,
  ])
  run("codeql", [
    "database",
    "analyze",
    database,
    "codeql/javascript-queries:codeql-suites/javascript-security-extended.qls",
    "--format=sarifv2.1.0",
    `--output=${sarif}`,
  ])
  const analysis = JSON.parse(readFileSync(sarif, "utf8")) as { runs?: { results?: unknown[] }[] }
  if (
    !Array.isArray(analysis.runs) ||
    analysis.runs.some((result) => !Array.isArray(result.results) || result.results.length > 0)
  )
    throw new Error("CodeQL did not produce a clean security report")
  run("pnpm", ["pack", "--pack-destination", temporary])
  const tarballs = readdirSync(temporary).filter((file) => file.endsWith(".tgz"))
  if (tarballs.length !== 1) throw new Error("expected one validated package")
  const tarball = join(temporary, tarballs[0] as string)
  const integrity = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`
  const installed = join(temporary, "installed")
  mkdirSync(installed, { mode: 0o700 })
  writeFileSync(join(installed, "package.json"), '{"private":true,"type":"module"}\n')
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], installed)
  run(process.execPath, [join(root, "scripts/installed-platform.mjs"), installed, version])
  if (run("git", ["rev-parse", "HEAD"]).trim() !== commit || run("git", ["status", "--porcelain"]).trim())
    throw new Error("the checkout changed during local validation")
  const token = options.env.NPM_TOKEN
  if (!token) throw new Error("local publication requires an exported NPM_TOKEN; no keyring lookup was attempted")
  const publishConfig = join(temporary, "publish.npmrc")
  writeFileSync(publishConfig, `//registry.npmjs.org/:_authToken=\${NPM_TOKEN}\n`, { mode: 0o600 })
  options.run(
    "npm",
    ["publish", tarball, "--access", "public", "--ignore-scripts"],
    {
      ...environment,
      NPM_CONFIG_USERCONFIG: publishConfig,
      NPM_TOKEN: token,
    },
    root,
  )
  const pause = options.pause ?? (() => new Promise<void>((done) => setTimeout(done, 3000)))
  let visible = false
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      visible =
        run("npm", ["view", `@wirecat/zoom-cli@${version}`, "dist.integrity", "--prefer-online"]).trim() === integrity
    } catch {
      visible = false
    }
    if (visible) break
    await pause()
  }
  if (!visible) throw new Error("npm did not expose the validated tarball; no tag or release was created")
  const downloaded = join(temporary, "registry")
  mkdirSync(downloaded, { mode: 0o700 })
  run("npm", ["pack", `@wirecat/zoom-cli@${version}`, "--ignore-scripts", "--pack-destination", downloaded])
  const published = readdirSync(downloaded).filter((file) => file.endsWith(".tgz"))
  if (
    published.length !== 1 ||
    `sha512-${createHash("sha512")
      .update(readFileSync(join(downloaded, published[0] as string)))
      .digest("base64")}` !== integrity
  )
    throw new Error(
      "the downloaded registry artifact differs from the validated tarball; no tag or release was created",
    )
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8")
  const heading = `## ${version} — `
  const start = changelog.indexOf(heading)
  if (start < 0) throw new Error("the published version has no dated changelog section")
  const end = changelog.indexOf("\n## ", start + heading.length)
  const notes = join(temporary, "release-notes.md")
  writeFileSync(notes, changelog.slice(start, end < 0 ? undefined : end))
  run("git", ["tag", "-a", `v${version}`, "-m", version])
  run("git", ["push", "origin", `refs/tags/v${version}`])
  run("gh", ["release", "create", `v${version}`, "--verify-tag", "--title", version, "--notes-file", notes])
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url))
  const secret = process.env.NPM_TOKEN
  const redact = (text: string) => (secret ? text.replaceAll(secret, "[redacted]") : text)
  const run: ReleaseRunner = (command, args, env, cwd) => {
    const child = spawnSync(command, [...args], { cwd, env, encoding: "utf8" })
    if (child.status !== 0) {
      process.stderr.write(redact(child.stderr ?? ""))
      throw new Error(`${command} failed; no further release steps were run`)
    }
    return child.stdout ?? ""
  }
  try {
    await localRelease(root, { env: process.env, run })
  } catch (error) {
    console.error(redact(error instanceof Error ? error.message : "local release failed"))
    process.exitCode = 1
  }
}
