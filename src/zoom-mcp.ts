import { CliError } from "@wirecat/cli-base"
import { checkCancelled, object } from "./errors.js"
import { operationSignal } from "./remote-http.js"
import type { TokenManager } from "./tokens.js"

export const ZOOM_MCP_URL = "https://mcp.zoom.us/mcp/zoom/streamable"
const PROTOCOL = "2025-06-18"

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const sessionStart = (scope: string) => `add ${scope} to the app and run zm <profile> session start again`

/** Zoom's hosted MCP server, called with the profile's own login; one session per instance. */
export class ZoomMcp {
  private session: string | undefined
  private initialized = false
  private id = 0
  constructor(
    readonly tokens: Pick<TokenManager, "tokens">,
    readonly fetcher: typeof fetch,
  ) {}

  async call(tool: string, args: Record<string, unknown>, scope: string, signal?: AbortSignal): Promise<unknown> {
    const operation = operationSignal(signal)
    const { accessToken, scopes } = await this.tokens.tokens()
    if (!scopes.includes(scope))
      throw new CliError("configuration_error", `Zoom scope ${scope} is missing; ${sessionStart(scope)}`)
    if (!this.initialized) {
      await this.rpc("initialize", accessToken, operation, {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "zm", version: "1" },
      })
      await this.rpc("notifications/initialized", accessToken, operation, {})
      this.initialized = true
    }
    const result = object(await this.rpc("tools/call", accessToken, operation, { name: tool, arguments: args }))
    const content = Array.isArray(result.content) ? result.content : []
    const text = content.find((part) => record(part) && typeof part.text === "string")?.text as string | undefined
    if (result.isError === true) throw toolError(text)
    if (record(result.structuredContent)) return result.structuredContent
    try {
      return JSON.parse(text ?? "")
    } catch {
      throw new CliError("invalid_response", `Zoom returned an invalid ${tool} answer`)
    }
  }

  private async rpc(method: string, accessToken: string, signal: AbortSignal, params: unknown): Promise<unknown> {
    checkCancelled(signal)
    const notification = method.startsWith("notifications/")
    const id = notification ? undefined : ++this.id
    let response: Response
    try {
      response = await this.fetcher(ZOOM_MCP_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(this.session ? { "mcp-session-id": this.session } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, params }),
        redirect: "manual",
        signal,
      })
    } catch {
      checkCancelled(signal)
      throw new CliError("network_error", "Zoom search could not be reached")
    }
    this.session = response.headers.get("mcp-session-id") ?? this.session
    const text = await response.text()
    const message = parseMessage(text, response.headers.get("content-type"), id)
    if (response.status === 401)
      throw new CliError("authentication_error", "Zoom refused the login; run zm <profile> session start again")
    // Zoom answers a missing scope with 403 and JSON-RPC error -32003 naming the scopes it wants.
    if (response.status === 403 && record(message?.error) && message.error.code === -32003)
      throw new CliError(
        "configuration_error",
        `Zoom wants scope ${String(message.error.message)}; ${sessionStart("it")}`,
      )
    if (!response.ok) throw new CliError("provider_error", `Zoom search failed (HTTP ${response.status})`)
    if (notification) return undefined
    if (!message) throw new CliError("invalid_response", "Zoom returned an invalid search answer")
    if (record(message.error))
      throw new CliError("provider_error", `Zoom search failed: ${String(message.error.message ?? "unknown error")}`)
    return message.result
  }
}

const parseMessage = (text: string, type: string | null, id: number | undefined) => {
  const parse = (body: string) => {
    try {
      const value = JSON.parse(body)
      return record(value) ? value : undefined
    } catch {
      return undefined
    }
  }
  if (!type?.includes("text/event-stream")) return text ? parse(text) : undefined
  const messages = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => parse(line.slice(5).trim()))
  return messages.find((value) => value && value.id === id) ?? messages.findLast((value) => value !== undefined)
}

/** Zoom puts a refused tool call (no license, no access) in the result text as JSON. */
const toolError = (text: string | undefined): CliError => {
  let body: Record<string, unknown> = {}
  try {
    const value = JSON.parse(text?.replace(/^[^{]*/, "") ?? "")
    if (record(value)) body = value
  } catch {}
  const reason = typeof body.error_message === "string" ? body.error_message : (text ?? "").slice(0, 200)
  const status = typeof body.status_code === "number" ? body.status_code : null
  return new CliError(
    status === 403 ? "permission_error" : status === 404 ? "not_found" : "invalid_response",
    `Zoom refused the request: ${reason || "no reason given"}`,
  )
}
