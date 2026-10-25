import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { type Body, listOf, NO_EFFECTS, REMOTE_READ } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { ZOOM_SEARCH_SOURCES, type ZoomSearch, type ZoomSearchSource } from "./zoom-search.js"

export type ZoomSearchService = Pick<ZoomSearch, "search">
const WORDS = Object.keys(ZOOM_SEARCH_SOURCES) as ZoomSearchSource[]

const sourcesOf = (text: string | undefined): ZoomSearchSource[] | undefined => {
  if (text === undefined) return undefined
  const words = text.split(",").map((word) => word.trim().toLowerCase())
  const unknown = words.filter((word) => !(WORDS as string[]).includes(word))
  if (!words.length || unknown.length)
    throw new CliError("validation_error", `--only takes ${WORDS.join(", ")}; got ${unknown.join(", ") || "nothing"}`)
  return [...new Set(words)] as ZoomSearchSource[]
}
const limitOf = (text: string | undefined): number => {
  if (text === undefined) return 10
  const value = Number(text)
  if (!/^\d+$/.test(text) || value < 1 || value > 100)
    throw new CliError("validation_error", "--limit must be between 1 and 100")
  return value
}

export const addZoomSearchCommands = (
  program: Command,
  deps: {
    search: () => ZoomSearchService
    api: () => void
    signal: () => AbortSignal | undefined
    output: (body: Body) => void
  },
): void => {
  const zoom = annotate(program.command("zoom"), { effects: NO_EFFECTS }).description(
    "Zoom's own live search: chat, docs and meetings zm does not archive",
  )
  annotate(zoom.command("search"), {
    origin: "handwritten",
    effects: REMOTE_READ,
    examples: [
      'zm personal zoom search "budget" --only chat,docs --json',
      "zm personal zoom search --only meetings --limit 50",
    ],
  })
    .description("search your Zoom workspace live; without words, list recent records")
    .argument("[query]", "words Zoom matches in the content; it does not widen word forms")
    .option("--only <resources>", `comma list of ${WORDS.join(", ")} (default Zoom's own choice)`)
    .option(
      "--limit <n>",
      "Zoom results per resource, 1 through 100 (default 10); one chat result holds its matching messages",
    )
    .option("--cursor <cursor>", "continue from the previous page's page.next_cursor, with the same query and --only")
    .action(async (query: string | undefined, options: { only?: string; limit?: string; cursor?: string }) => {
      const sources = sourcesOf(options.only)
      const limit = limitOf(options.limit)
      deps.api()
      const page = await deps.search().search({ query, sources, limit, cursor: options.cursor, signal: deps.signal() })
      deps.output(
        listOf("zoom search", {
          items: page.items,
          limit: Math.max(1, page.items.length),
          has_more: page.has_more,
          paging: "cursor",
          ...(page.cursor ? { cursor: page.cursor } : {}),
          args: {
            ...(query === undefined ? {} : { query }),
            ...(options.only === undefined ? {} : { only: options.only }),
            limit,
          },
        }),
      )
    })
}
