import { expect, it } from "vitest"
import type { ZoomConfig } from "./config.js"
import { ZoneAssumptions } from "./errors.js"
import { configuredMeetingSource } from "./meeting-source.js"
import type { TokenManager } from "./tokens.js"

it("asks for the client ID, not a login, when an API source has none", async () => {
  const { source } = configuredMeetingSource({
    deps: {},
    getConfig: () => ({ source: "api", clientId: null }) as ZoomConfig,
    tokens: () => ({ options: { clientId: "" } }) as TokenManager,
    fetch: () => fetch,
    zones: new ZoneAssumptions(),
  })
  await expect(source.meetings("")).rejects.toThrow("zm config set zoom.client_id")
})

it("reads Zoom live through the configured API source, not a detached method", async () => {
  const { memoryKeyring } = await import("@wirecat/cli-base")
  const { TokenManager } = await import("./tokens.js")
  const manager = new TokenManager({ clientId: "example-client", keyring: memoryKeyring(), service: "example", fetch })
  manager.save({
    accessToken: "example-access",
    refreshToken: "example-refresh",
    expiresAt: Number.MAX_SAFE_INTEGER,
    scopes: ["meeting:read:list_meetings"],
  })
  const requests: string[] = []
  const { source } = configuredMeetingSource({
    deps: {},
    getConfig: () => ({ source: "api", clientId: "example-client" }) as ZoomConfig,
    tokens: () => manager,
    fetch: () => async (input) => {
      requests.push(new URL(String(input)).pathname)
      return new Response(JSON.stringify({ meetings: [], next_page_token: "" }))
    },
    zones: new ZoneAssumptions(),
  })
  expect(await source.find?.({}, [], null)).toEqual({ meetings: [], next: null })
  expect(requests).toEqual(["/v2/users/me/meetings"])
})
