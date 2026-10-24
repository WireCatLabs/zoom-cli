import { annotate } from "@wirecat/cli-base/commands"
import { defineQuery } from "@wirecat/cli-base/query"
import {
  type Body,
  itemOf,
  listOf,
  NO_EFFECTS,
  queryTerms,
  REMOTE_READ,
  termField,
  typedQuery,
  withQuery,
} from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { CONTACT_TYPES, type ContactType, type ZoomContact, type ZoomContacts } from "./contacts.js"

export type ContactsService = Pick<ZoomContacts, "list" | "show">

/** Zoom answers each contact type whole; the terms narrow what came back. */
const CONTACTS_QUERY = defineQuery({
  entity: "contact",
  backend: "native",
  fields: [
    termField("name", "txt", "name:alice"),
    termField("email", "kw", "email:alice@example.com"),
    termField("type", "enum", "type:external", { values: [...CONTACT_TYPES] }),
  ],
})
const has = (value: string | null, part: string | undefined) =>
  part === undefined || (value ?? "").toLowerCase().includes(part.toLowerCase())

export const addContactsCommands = (
  program: Command,
  deps: {
    contacts: () => ContactsService
    api: () => void
    signal: () => AbortSignal | undefined
    output: (body: Body) => void
  },
): void => {
  const contacts = annotate(program.command("contacts"), { effects: NO_EFFECTS }).description(
    "your Zoom contacts, read live: company colleagues and external contacts",
  )
  withQuery(
    annotate(contacts.command("list"), {
      origin: "handwritten",
      effects: REMOTE_READ,
      output: { entity: "contact" },
      examples: ["zm personal contacts list --json", "zm personal contacts list type:external name:alice"],
    }),
    CONTACTS_QUERY,
  )
    .description("list your company and external Zoom contacts")
    .action(async (words: string[]) => {
      const terms = queryTerms(typedQuery(words), CONTACTS_QUERY, "contacts list")
      const type = terms.get("type") as ContactType | undefined
      deps.api()
      const service = deps.contacts()
      let items: ZoomContact[] = []
      for (const one of type ? [type] : CONTACT_TYPES)
        items = items.concat(await service.list(one, { signal: deps.signal() }))
      const kept = items.filter((item) => has(item.name, terms.get("name")) && has(item.email, terms.get("email")))
      deps.output(listOf("contacts list", { items: kept, limit: Math.max(1, kept.length), has_more: false }))
    })
  annotate(contacts.command("show"), {
    origin: "handwritten",
    effects: REMOTE_READ,
    output: { entity: "contact" },
    examples: ["zm personal contacts show alice@example.com --json"],
  })
    .description("one contact with their phone numbers")
    .argument("<contact>", "their member id from `contacts list`, Zoom user id or email")
    .action(async (who: string) => {
      deps.api()
      deps.output(itemOf(await deps.contacts().show(who, { signal: deps.signal() })))
    })
}
