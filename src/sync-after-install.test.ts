import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { memoryMeetingStore } from "@wirecat/cli-core/meetings/testing"
import { syncAfterInstallCases } from "@wirecat/cli-core/testing"
import { describe, it } from "vitest"
import { type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const signedIn = async (env: NodeJS.ProcessEnv) => {
  const stderr: string[] = []
  const deps: ProgramDeps = {
    configPath: join(await mkdtemp(join(tmpdir(), "zm-install-")), "config.json"),
    tokens: new TokenManager({
      clientId: "example-client",
      keyring: memoryKeyring(),
      service: "example",
      fetch: async () => {
        throw new Error("unexpected token refresh")
      },
      now: () => 0,
    }),
    fetch: async () => new Response(JSON.stringify({ meetings: [] })),
    openBrowser: async () => {
      throw new Error("unexpected browser")
    },
    data: () => {},
    diagnostic: (text) => stderr.push(text),
    store: memoryMeetingStore(),
    accountId: 1,
    env: { ...process.env, ...env },
  }
  deps.tokens.forProfile("example").save({
    accessToken: "example-access",
    refreshToken: "example-refresh",
    expiresAt: 3600000,
    scopes: ["meeting:read:list_meetings"],
  })
  return { deps, stderr }
}

describe("sync runs right after install, whatever the shared WireCat config holds", () => {
  for (const one of syncAfterInstallCases({
    sync: ["example", "meetings", "sync", "--since-time", "2026-10-01"],
    run: async (argv, env) => {
      const { deps, stderr } = await signedIn(env)
      return { code: await run(argv, deps), err: stderr.join("") }
    },
  }))
    it(one.name, () => one.run())
})
