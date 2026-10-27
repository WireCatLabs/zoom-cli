import { isCliError } from "@wirecat/cli-base"
import { currentAttempt, providerRequest, type RequestEvent } from "@wirecat/cli-core/cli"

const SEGMENT = /^(?:v\d+|[a-z][a-z_]{0,23})$/

/**
 * `GET /v2/users/:id/recordings`: the method and the path's fixed words. A segment that is not one — a meeting
 * id, a uuid, an email, a download token — becomes `:id`, and the host and query are dropped.
 */
export const operationOf = (method: string, url: string): string => {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return `${method.toUpperCase()} :url`
  }
  const words = path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      const [head = "", verb] = segment.split(":")
      const base = SEGMENT.test(head) ? head : ":id"
      if (verb === undefined) return base
      return SEGMENT.test(verb) ? `${base}:${verb}` : base
    })
  return `${method.toUpperCase()} /${words.join("/")}`
}

/** What `ZoomRemote` adds for the run's request line; the fetch itself never sees it. */
export interface WireInit extends RequestInit {
  /** 1 for the first try, 2 and up for a retry. */
  attempt?: number
  /** What was waited before this attempt: Retry-After, or the backoff. */
  waitMs?: number
}

const ERROR_BODY_BYTES = 4096

/**
 * Zoom's own name for a refusal, `zoom.429`, from the `code` of an error body; never its `message`. A body over
 * 4 KB, or one that is not JSON, gives none. Reads a clone, so the caller's body is untouched.
 */
export const zoomErrorName = async (response: Response): Promise<string | undefined> => {
  const reader = response.clone().body?.getReader()
  if (!reader) return undefined
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > ERROR_BODY_BYTES) return undefined
      chunks.push(value)
    }
  } catch {
    return undefined
  } finally {
    reader.cancel().catch(() => {})
  }
  try {
    const { code } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { code?: unknown }
    return typeof code === "number" || (typeof code === "string" && /^\w{1,32}$/.test(code))
      ? `zoom.${code}`
      : undefined
  } catch {
    return undefined
  }
}

/** A fetch that logs each request's operation, status and duration into the command's run — never its content. */
export const observedFetch =
  (fetcher: typeof fetch, sink: (event: RequestEvent) => void): typeof fetch =>
  async (input, init) => {
    const { attempt = currentAttempt() ? undefined : 1, waitMs, ...sent } = (init ?? {}) as WireInit
    const method = (sent.method ?? "GET").toUpperCase()
    const operation = operationOf(method, input instanceof Request ? input.url : String(input))
    const answered = providerRequest(operation, sink, {
      method,
      endpointTemplate: operation.slice(method.length + 1),
      transport: "http",
      ...(attempt === undefined ? {} : { attempt }),
      ...(waitMs === undefined ? {} : { waitMs }),
    })
    try {
      const response = await fetcher(input, init === undefined ? undefined : sent)
      if (response.status < 400) answered({ status: response.status })
      else {
        const providerError = await zoomErrorName(response)
        answered({ status: response.status, errorCode: "provider_error", ...(providerError ? { providerError } : {}) })
      }
      return response
    } catch (error) {
      answered({ error, errorCode: isCliError(error) ? error.code : "network_error" })
      throw error
    }
  }
