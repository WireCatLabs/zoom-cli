import { describe, expect, it } from "vitest"
import { zoomApp } from "./zoom-app.js"

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
