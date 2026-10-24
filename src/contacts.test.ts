import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { memoryKeyring } from "@wirecat/cli-base"
import { memoryMeetingStore } from "@wirecat/cli-core/meetings/testing"
import { expect, it } from "vitest"
import { declaredAnswerIssue } from "../scripts/testing/answers.js"
import { useProfile } from "../scripts/testing/profile.js"
import { setConfig } from "./config.js"
import { type ContactType, ZoomContacts } from "./contacts.js"
import type { ContactsService } from "./contacts-commands.js"
import { createProgram, type ProgramDeps, run } from "./program.js"
import { TokenManager } from "./tokens.js"

const scopes = ["team_chat:read:list_contacts", "team_chat:read:contact"]
const tokens = {
  tokens: async () => ({ accessToken: "example-access", refreshToken: "example-refresh", expiresAt: 3600000, scopes }),
}
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
const source = (fetcher: typeof fetch) => new ZoomContacts(tokens, fetcher, { sleep: async () => {} })
const alice = {
  member_id: "member-alice",
  id: "",
  first_name: "Alice",
  last_name: "Example",
  email: "alice@example.com",
}

it("lists one contact type page by page, keyed by member id because external contacts have no user id", async () => {
  const asked: URL[] = []
  const contacts = await source(async (input) => {
    const url = new URL(String(input))
    asked.push(url)
    return url.searchParams.get("next_page_token")
      ? response({ contacts: [{ member_id: "member-bob", first_name: "Bob" }] })
      : response({ contacts: [alice], next_page_token: "example-page" })
  }).list("external")
  expect(asked.map((url) => [url.pathname, url.searchParams.get("type"), url.searchParams.get("page_size")])).toEqual([
    ["/v2/chat/users/me/contacts", "external", "50"],
    ["/v2/chat/users/me/contacts", "external", "50"],
  ])
  expect(contacts).toEqual([
    {
      ref: "contact:zoom/member-alice",
      id: "member-alice",
      name: "Alice Example",
      username: null,
      description: null,
      last_messaged_at: null,
      email: "alice@example.com",
    },
    expect.objectContaining({ id: "member-bob", name: "Bob", email: null }),
  ])
})

it("refuses a contact list Zoom got wrong instead of answering part of it", async () => {
  await expect(source(async () => response({ contacts: "none" })).list("company")).rejects.toThrow(/invalid contact/)
  await expect(
    source(async () => response({ contacts: [{ email: "x@example.com" }] })).list("company"),
  ).rejects.toThrow(/member id/)
  await expect(
    source(async () => response({ contacts: [], next_page_token: "repeat" })).list("company"),
  ).rejects.toThrow(/pagination/)
})

it("shows one contact with every phone number Zoom gives, once each", async () => {
  let path = ""
  const contact = await source(async (input) => {
    path = new URL(String(input)).pathname
    return response({
      ...alice,
      phone_number: "5550100",
      phone_numbers: [{ code: "+1", number: "5550100", label: "Mobile" }, { label: "Home" }],
      direct_numbers: ["+15550199", " "],
    })
  }).show(" alice@example.com ")
  expect(path).toBe("/v2/chat/users/me/contacts/alice%40example.com")
  expect(contact.phones).toEqual([
    { number: "+1 5550100", label: "Mobile" },
    { number: "+15550199", label: "Direct" },
  ])
  await expect(source(async () => response(alice)).show(" ")).rejects.toThrow(/member id, user id or email/)
})

const program = () => {
  const directory = mkdtempSync(join(tmpdir(), "zm-test-contacts-"))
  const stdout: string[] = []
  const types: ContactType[] = []
  const contacts: ContactsService = {
    list: async (type) => {
      types.push(type)
      return type === "company"
        ? [{ ...contact("member-alice", "Alice Example"), email: "alice@example.com" }]
        : [contact("member-bob", "Bob Sample")]
    },
    show: async (who) => ({ ...contact(who, "Alice Example"), phones: [{ number: "+1 5550100", label: "Mobile" }] }),
  }
  const deps: ProgramDeps = {
    configPath: join(directory, "config.json"),
    tokens: new TokenManager({ clientId: "example-client", keyring: memoryKeyring(), service: "example", fetch }),
    fetch: async () => {
      throw new Error("unexpected network")
    },
    store: memoryMeetingStore(),
    accountId: 1,
    openBrowser: async () => {},
    data: (text) => stdout.push(text),
    diagnostic: () => {},
    contacts,
  }
  setConfig(deps.configPath, "zoom.clientId", "example-client")
  useProfile(deps.configPath, "work")
  const answer = async (argv: string[]) => {
    stdout.length = 0
    expect(await run([...argv, "--json"], deps), argv.join(" ")).toBe(0)
    return JSON.parse(stdout.join("")) as { items?: { name: string }[] }
  }
  return { deps, answer, types }
}
const contact = (id: string, name: string) => ({
  ref: `contact:zoom/${id}`,
  id,
  name,
  username: null,
  description: null,
  last_messaged_at: null,
  email: null,
})

it("lists company and external contacts as the shared contact entity, narrowed by name, email and type", async () => {
  const { deps, answer, types } = program()
  const all = await answer(["contacts", "list"])
  expect(all.items?.map((item) => item.name)).toEqual(["Alice Example", "Bob Sample"])
  expect(types).toEqual(["company", "external"])
  expect(declaredAnswerIssue(createProgram(deps), "contacts list", all)).toBeUndefined()
  expect((await answer(["contacts", "list", "name:ALICE"])).items?.map((item) => item.name)).toEqual(["Alice Example"])
  expect((await answer(["contacts", "list", "email:example.com"])).items).toHaveLength(1)
  types.length = 0
  expect((await answer(["contacts", "list", "type:external"])).items?.map((item) => item.name)).toEqual(["Bob Sample"])
  expect(types).toEqual(["external"])
  const shown = await answer(["contacts", "show", "member-alice"])
  expect(declaredAnswerIssue(createProgram(deps), "contacts show", shown)).toBeUndefined()
})
