import { annotate } from "@wirecat/cli-base/commands"
import { type Body, LOCAL_READ, listOf, NO_EFFECTS, withQuery } from "@wirecat/cli-core/cli"
import { type MeetingReview, meetingLinkItem, meetingReviewItem } from "@wirecat/cli-core/meetings"
import type { MeetingLink, MeetingLinksRequest, MeetingReviewRequest } from "@wirecat/cli-core/services"
import type { Command } from "commander"
import { bytes } from "./execution.js"
import {
  linkSelection,
  MEETING_LINK_QUERY,
  type SelectionFlags,
  selectionOf,
  selectionOptions,
} from "./meeting-selection-options.js"

export type MeetingReviewRead = (request: Omit<MeetingReviewRequest, "accountId">) => Promise<MeetingReview>
export type MeetingLinksRead = (
  request: Omit<MeetingLinksRequest, "accountId">,
) => Promise<{ items: MeetingLink[]; messages: number; meetings: number }>

/** Fewer words than this is a transcript that holds next to nothing: a few lines before the recording stopped. */
const NEAR_EMPTY_WORDS = 50
const REVIEW_SINCE = "7d"

/**
 * `review`: the meetings since a point, each with what was decided and who talked — tg's `review` for meetings.
 * `mentions list`: the links shared in the chat of those meetings.
 */
export const addMeetingReviewCommands = (
  program: Command,
  deps: {
    review: () => Promise<MeetingReviewRead>
    links: () => Promise<MeetingLinksRead>
    signal: () => AbortSignal | undefined
    output: (body: Body) => void
  },
): void => {
  annotate(selectionOptions(program.command("review")), {
    effects: LOCAL_READ,
    output: { entity: "meeting_review" },
    examples: ["zm personal review --json", "zm personal review --since-time 30d --project RES --json"],
  })
    .description("meetings since a point: summary, next steps and who talked how long")
    .option("--limit <n>", "most meetings, newest first (default 50, at most 200)", bytes)
    .action(async (flags: SelectionFlags & { limit?: number }) => {
      const { request, meta } = selectionOf(flags, deps.signal(), REVIEW_SINCE)
      const limit = flags.limit ?? 50
      const found = await (await deps.review())({ ...request, limit })
      const unsummarized = found.items.filter((one) => one.summary === null).length
      const nearEmpty = found.items.filter((one) => one.transcript && one.transcript.words < NEAR_EMPTY_WORDS).length
      deps.output(
        listOf("review", {
          items: found.items.map(meetingReviewItem),
          limit,
          has_more: found.hasMore,
          meta,
          missing: [
            ...(unsummarized
              ? [
                  {
                    field: "items[].summary",
                    why: `${unsummarized} meetings have no summary: Zoom writes one only when AI Companion summarised the meeting, and imported transcripts carry none — read them with meetings transcript`,
                  },
                ]
              : []),
            ...(nearEmpty
              ? [
                  {
                    field: "items[].transcript",
                    why: `${nearEmpty} transcripts hold fewer than ${NEAR_EMPTY_WORDS} words: an empty search there means it was not recorded, not that it was not said`,
                  },
                ]
              : []),
          ],
        }),
      )
    })

  const mentions =
    program.commands.find((command) => command.name() === "mentions") ??
    annotate(program.command("mentions"), { effects: NO_EFFECTS }).description(
      "what the stored meetings point to: links shared in their chat",
    )
  withQuery(
    annotate(selectionOptions(mentions.command("list"), true), {
      effects: LOCAL_READ,
      output: { entity: "meeting_link" },
      examples: ["zm personal mentions list --since-time 30d --json", "zm personal mentions list project:RES --json"],
    }),
    MEETING_LINK_QUERY,
  )
    .description("links shared in meeting chat, most shared first, by whom and where")
    .option("--limit <n>", "how many links (default 100)", bytes)
    .option("--max-messages <n>", "most chat messages to read (default and at most 100000)", bytes)
    .action(async (words: string[], flags: SelectionFlags & { limit?: number; maxMessages?: number }) => {
      const { request, meta } = selectionOf(linkSelection(words, flags), deps.signal())
      const limit = flags.limit ?? 100
      const found = await (await deps.links())({
        ...request,
        ...(flags.maxMessages === undefined ? {} : { maxMessages: flags.maxMessages }),
      })
      deps.output(
        listOf("mentions list", {
          items: found.items.slice(0, limit).map(meetingLinkItem),
          limit,
          has_more: found.items.length > limit,
          meta,
          missing:
            found.messages === 0
              ? [
                  {
                    field: "items",
                    why: "no meeting chat is stored for these meetings: zm reads the chat Zoom saves with a cloud recording, at meetings sync",
                  },
                ]
              : [],
        }),
      )
    })
}
