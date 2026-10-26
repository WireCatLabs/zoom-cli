import { isCliError } from "@wirecat/cli-base"
import { providerRequest, type RequestEvent } from "@wirecat/cli-core/cli"

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

/** A fetch that logs each request's operation, status and duration into the command's run — never its content. */
export const observedFetch =
  (fetcher: typeof fetch, sink: (event: RequestEvent) => void): typeof fetch =>
  async (input, init) => {
    const answered = providerRequest(
      operationOf(init?.method ?? "GET", input instanceof Request ? input.url : String(input)),
      sink,
    )
    try {
      const response = await fetcher(input, init)
      answered(
        response.status < 400 ? { status: response.status } : { status: response.status, errorCode: "provider_error" },
      )
      return response
    } catch (error) {
      answered({ error, errorCode: isCliError(error) ? error.code : "network_error" })
      throw error
    }
  }
