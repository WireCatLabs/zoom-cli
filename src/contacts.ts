import { CliError } from "@wirecat/cli-base"
import { formatReference } from "@wirecat/cli-core"
import * as v from "valibot"
import { operationSignal, type RemoteOptions, ZoomRemote } from "./remote-http.js"
import type { TokenManager } from "./tokens.js"
import { GetUserContactResponse, GetUserContactsResponse } from "./zoom-api/schemas.js"

export type ContactType = "company" | "external"
export const CONTACT_TYPES: readonly ContactType[] = ["company", "external"]

export interface ZoomContact {
  ref: string
  id: string
  name: string | null
  username: null
  description: null
  last_messaged_at: null
  email: string | null
  phones?: { number: string; label: string | null }[]
}

const parsed = <T>(schema: v.GenericSchema<unknown, T>, body: unknown): T => {
  const result = v.safeParse(schema, body)
  if (!result.success) throw new CliError("invalid_response", "Zoom returned an invalid contact")
  return result.output
}
const nonEmpty = (text: string | undefined) => (text?.trim() ? text.trim() : null)

/** `member_id` is the only id Zoom gives external contacts too; `id` is empty outside the user's account. */
const contactOf = (row: { member_id?: string; first_name?: string; last_name?: string; email?: string }) => {
  const id = nonEmpty(row.member_id)
  if (!id) throw new CliError("invalid_response", "Zoom returned a contact without a member id")
  const name = [nonEmpty(row.first_name), nonEmpty(row.last_name)].filter(Boolean).join(" ")
  return {
    ref: formatReference({ type: "contact", provider: "zoom", id }),
    id,
    name: name || null,
    username: null,
    description: null,
    last_messaged_at: null,
    email: nonEmpty(row.email),
  } satisfies ZoomContact
}

export class ZoomContacts {
  readonly remote: ZoomRemote
  constructor(tokens: Pick<TokenManager, "tokens">, fetcher: typeof fetch, options: RemoteOptions = {}) {
    this.remote = new ZoomRemote(tokens, fetcher, options)
  }
  async list(type: ContactType, options: { signal?: AbortSignal } = {}): Promise<ZoomContact[]> {
    const signal = operationSignal(options.signal)
    const query = new URLSearchParams({ type, page_size: "50" })
    const seen = new Set<string>()
    const found = new Map<string, ZoomContact>()
    for (;;) {
      const body = parsed(
        GetUserContactsResponse,
        await this.remote.request(`/chat/users/me/contacts?${query}`, "team_chat:read:list_contacts", { signal }),
      )
      for (const row of body.contacts ?? []) {
        const contact = contactOf(row)
        found.set(contact.id, contact)
      }
      const next = nonEmpty(body.next_page_token)
      if (!next) return [...found.values()]
      if (seen.has(next)) throw new CliError("invalid_response", "Zoom repeated a pagination token")
      seen.add(next)
      query.set("next_page_token", next)
    }
  }
  /** `who` is a member id, a Zoom user id or an email address. */
  async show(who: string, options: { signal?: AbortSignal } = {}): Promise<ZoomContact> {
    if (!who.trim()) throw new CliError("validation_error", "a contact is a member id, user id or email")
    const body = parsed(
      GetUserContactResponse,
      await this.remote.request(
        `/chat/users/me/contacts/${encodeURIComponent(who.trim())}`,
        "team_chat:read:contact",
        options,
      ),
    )
    const phones = (body.phone_numbers ?? []).flatMap((phone) => {
      const number = nonEmpty([phone.code, phone.number].filter(Boolean).join(" "))
      return phone.number && number ? [{ number, label: phone.label ?? null }] : []
    })
    const direct = (body.direct_numbers ?? []).flatMap((number) =>
      nonEmpty(number) ? [{ number: number.trim(), label: "Direct" }] : [],
    )
    const primary = nonEmpty(body.phone_number)
    const listed = primary && !phones.some((phone) => phone.number.endsWith(primary))
    return { ...contactOf(body), phones: [...(listed ? [{ number: primary, label: null }] : []), ...phones, ...direct] }
  }
}
