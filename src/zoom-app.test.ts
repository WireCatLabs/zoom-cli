import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { ZOOM_APP_SCOPES, zoomApp, zoomAppChecklist } from "./zoom-app.js"

const env = { ZM_ZOOM_CLIENT_ID: "example-env-client" }

describe("which Zoom app a sign-in uses", () => {
  it("takes --client-id, then ZM_ZOOM_CLIENT_ID, then zoom.client_id, and none when nothing names one", () => {
    const of = (options: Parameters<typeof zoomApp>[0]) => {
      const app = zoomApp(options)
      return app && [app.client.clientId, app.source]
    }
    expect(of({ env, configClientId: "example-config-client", clientId: "example-flag-client" })).toEqual([
      "example-flag-client",
      "flag",
    ])
    expect(of({ env, configClientId: "example-config-client" })).toEqual(["example-env-client", "env"])
    expect(of({ env: {}, configClientId: "example-config-client" })).toEqual(["example-config-client", "config"])
    expect(of({ env: {}, configClientId: null })).toBeUndefined()
  })
})

describe("what to enter when making the Zoom app", () => {
  it("lists every scope a request in the code names, and only those", () => {
    const source = new URL(".", import.meta.url)
    const named = new Set<string>()
    const code = (name: string) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "zoom-app.ts"
    for (const file of readdirSync(source, { recursive: true, encoding: "utf8" }).filter(code))
      for (const [, scope] of readFileSync(new URL(file, source), "utf8").matchAll(
        /"([a-z_]+:(?:read|write|update|delete):[a-z_]+)"/g,
      ))
        named.add(scope as string)
    expect(ZOOM_APP_SCOPES.map((one) => one.scope).sort()).toEqual([...named].sort())
  })
  it("prints a numbered checklist with the redirect and the scopes sync needs", () => {
    const text = zoomAppChecklist()
    expect(text).toMatch(/^1\. Open https:\/\/marketplace\.zoom\.us\/develop\/create/)
    expect(text).toContain("OAuth Redirect URL: https://wirecat.dev/zoom-callback")
    expect(text).toContain("meeting:read:summary")
  })
})
