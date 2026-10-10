import { createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { ZoomError } from "./errors.js"
import type { TokenManager } from "./tokens.js"

export const REDIRECT = "https://wirecat.dev/zoom-callback"
export interface LoginOptions {
  tokens: TokenManager
  openBrowser: (url: string) => Promise<void>
  readPaste?: (signal: AbortSignal) => Promise<string>
  showUrl?: (url: string) => void
  timeoutMs?: number
}
export const login = async (options: LoginOptions) => {
  const verifier = randomBytes(48).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  const controller = new AbortController()
  let state = ""
  let accept: (code: string) => void = () => {}
  let fail: (error: Error) => void = () => {}
  const codePromise = new Promise<string>((resolve, reject) => {
    accept = resolve
    fail = reject
  })
  // Startup and paste can fail before the callback is awaited.
  void codePromise.catch(() => {})
  const server = createServer((request, response) => {
    const query = new URL(request.url ?? "/", "http://127.0.0.1")
    if (query.pathname !== "/callback") {
      response.writeHead(404).end()
      return
    }
    if (query.searchParams.get("state") !== state) {
      response.writeHead(400).end("state does not match")
      return
    }
    const code = query.searchParams.get("code")
    response.end("zm: received, you can close this tab")
    if (code) accept(code)
    else fail(new ZoomError("authentication_error", "Zoom login was not approved"))
  })
  const timer = setTimeout(
    () => fail(new ZoomError("authentication_error", "Zoom login timed out")),
    options.timeoutMs ?? 300000,
  )
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    const address = server.address()
    if (!address || typeof address === "string")
      throw new ZoomError("configuration_error", "could not start the local login listener")
    state = `${address.port}.${randomBytes(24).toString("base64url")}`
    const authorize = new URL("https://zoom.us/oauth/authorize")
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: options.tokens.options.clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    }).toString()
    options.showUrl?.(authorize.toString())
    const pastePromise = options.readPaste?.(controller.signal).then((text) => {
      const query = new URLSearchParams(text.includes("?") ? text.slice(text.indexOf("?") + 1) : text)
      if (query.get("state") !== state || !query.get("code"))
        throw new ZoomError("authentication_error", "pasted login must contain the matching code and state")
      return query.get("code") ?? ""
    })
    // Paste remains available if the browser cannot start or the callback cannot reach loopback.
    void Promise.resolve()
      .then(() => options.openBrowser(authorize.toString()))
      .catch(() => {
        if (!options.readPaste)
          fail(new ZoomError("configuration_error", "could not open the browser; retry with --browser <program>"))
      })
    const code = await (pastePromise ? Promise.race([codePromise, pastePromise]) : codePromise)
    controller.abort()
    const tokens = await options.tokens.exchange({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    })
    return { loggedIn: true, scopes: tokens.scopes }
  } finally {
    clearTimeout(timer)
    controller.abort()
    server.close()
    server.closeAllConnections()
  }
}
