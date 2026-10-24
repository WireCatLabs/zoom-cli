import { CliError } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import {
  type Body,
  FETCH,
  itemOf,
  LOCAL_READ,
  LOCAL_WRITE,
  listOf,
  listQuery,
  NO_EFFECTS,
  SEARCHES_QUERY,
  typedQuery,
  withQuery,
} from "@wirecat/cli-core/cli"
import { type MeetingSearchesService, savedSearchItem as searchItem } from "@wirecat/cli-core/services"
import { type Command, CommanderError, Option } from "commander"
import { type MeetingSearchRun, meetingSearchDefinition } from "./meeting-search-commands.js"

/**
 * A page position belongs to one run; saved, it would point into a result that no longer exists. Store ids are left
 * out too: a saved search names what lasts — dates, a project, a topic.
 */
const UNSAVED = new Set(["cursor", "meetingId", "identityId", "personId", "seriesId", "tag"])

type Typed = Record<string, string | boolean>

const flagsOf = (typed: Typed): string[] => {
  const { command } = meetingSearchDefinition()
  return command.options.flatMap((option) => {
    const value = typed[option.attributeName()]
    if (value === undefined || !option.long) return []
    return value === true ? [option.long] : [option.long, String(value)]
  })
}

/** The options as `search meetings` reads them, read again at each run. */
const parsed = async (query: string, typed: Typed): Promise<{ query: string; options: Record<string, unknown> }> => {
  const { program, command } = meetingSearchDefinition()
  let found: { query: string; options: Record<string, unknown> } | undefined
  command.action((text: string, options: Record<string, unknown>) => {
    found = { query: text, options }
  })
  for (const one of [program, ...program.commands, command])
    one.exitOverride().configureOutput({ writeErr: () => {}, writeOut: () => {} })
  try {
    await program.parseAsync(["search", "meetings", query, ...flagsOf(typed)], { from: "user" })
  } catch (error) {
    if (error instanceof CommanderError) throw new CliError("validation_error", error.message.replace(/^error: /, ""))
    throw error
  }
  if (!found) throw new CliError("validation_error", "the saved search could not be read")
  return found
}

/** Saved meeting searches: a query with its options under a name, run again with `searches run`. */
export const addMeetingSearchesCommands = (
  program: Command,
  deps: {
    searches: () => Promise<MeetingSearchesService>
    search: MeetingSearchRun
    output: (body: Body) => void
  },
): void => {
  const searches = annotate(program.command("searches"), { effects: NO_EFFECTS }).description(
    "saved meeting searches: a query and its options under a name",
  )
  const create = annotate(searches.command("create"), {
    effects: LOCAL_WRITE,
    output: { entity: "saved_search" },
    examples: ['zm personal searches create weekly-plan "example plan date>=7d" --project RES --json'],
  })
    .description("save a search meetings query and its options without running it")
    .argument("<name>", "up to 64 letters a–z, digits and hyphens, not only digits")
    .argument("<query>", "the query, as search meetings takes it")
    .option("--replace", "overwrite a saved search of the same name")
  for (const option of meetingSearchDefinition().command.options)
    if (!UNSAVED.has(option.attributeName()))
      create.addOption(new Option(option.flags, option.description).hideHelp(option.hidden))
  create.action(async (name: string, query: string, flags: Typed & { replace?: boolean }) => {
    const { replace, ...typed } = flags
    await parsed(query, typed)
    const saved = await (await deps.searches()).create(name, { query, options: typed }, { replace: replace === true })
    deps.output(itemOf(searchItem(saved)))
  })

  annotate(searches.command("run"), {
    effects: FETCH,
    output: { entity: "meeting_hit" },
    examples: ["zm personal searches run weekly-plan --json"],
  })
    .description("run a saved search; answers as search meetings does")
    .argument("<name>", "a saved search's name")
    .action(async (name: string) => {
      const saved = await (await deps.searches()).run(name)
      const { query, options } = await parsed(saved.query, saved.options as Typed)
      deps.output(await deps.search(query, options))
    })

  withQuery(
    annotate(searches.command("list"), {
      effects: LOCAL_READ,
      output: { entity: "saved_search" },
      examples: ["zm personal searches list --json"],
    }),
    SEARCHES_QUERY,
  )
    .description("the saved meeting searches, by name")
    .action(async (words: string[]) => {
      listQuery(typedQuery(words), SEARCHES_QUERY, "searches list")
      const found = await (await deps.searches()).list()
      deps.output(
        listOf("searches list", { items: found.map(searchItem), limit: Math.max(1, found.length), has_more: false }),
      )
    })

  annotate(searches.command("show"), {
    effects: LOCAL_READ,
    output: { entity: "saved_search" },
    examples: ["zm personal searches show weekly-plan"],
  })
    .description("one saved search: its query, options and how often it ran")
    .argument("<name>", "a saved search's name")
    .action(async (name: string) => {
      deps.output(itemOf(searchItem(await (await deps.searches()).show(name))))
    })

  annotate(searches.command("delete"), {
    effects: LOCAL_WRITE,
    output: { entity: "saved_search" },
    examples: ["zm personal searches delete weekly-plan"],
  })
    .description("delete a saved search")
    .argument("<name>", "a saved search's name")
    .action(async (name: string) => {
      deps.output(itemOf(searchItem(await (await deps.searches()).delete(name))))
    })
}
