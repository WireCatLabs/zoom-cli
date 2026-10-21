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
