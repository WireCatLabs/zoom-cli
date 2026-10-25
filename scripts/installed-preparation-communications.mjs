import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

export const checkPreparationCommunications = async ({ load, path, now, key, connector, readOptions }) => {
  const { openStore } = await load("@wirecat/cli-core/store")
  const { contractSeed } = await load("@wirecat/cli-core/testing")
  const { parseLucene } = await load("@wirecat/cli-base/query")
  const { captureContextSources, createZoomPreparationReader } = await load("@wirecat/zoom-cli")
  const { readMeetingPreparation, callMeetingPreparationTool } = await load("@wirecat/cli-core/cli")
  const { projectFields } = await load("@wirecat/cli-base")
  const store = await openStore({ path, now: () => now - 86400000 })
  let folderId
  try {
    const seed = contractSeed(),
      chat = seed.chats[0],
      message = seed.messages.find((m) => m.chatId === chat?.id)
    assert.ok(chat && message)
    for (const account of ["ExampleWork", "ExampleUnselected"]) {
      const owner = { provider: "example-messenger", account }
      await store.accounts.saveAccount(owner, { name: account })
      await store.chats.saveChats(owner, [chat])
      await store.messages.saveMessages(
        owner,
        chat.id,
        [
          {
            ...message,
            timestamp: new Date(now - 5 * 86400000).toISOString(),
            text: "Launch Friday: target Monday.",
          },
        ],
        { via: "history" },
      )
    }
    const folder = await store.notes.addFolder({ name: "Example launch files" })
    folderId = folder.id
    await store.notes.saveFileNote({
      folderId,
      path: "launch.md",
      title: "Launch update",
      text: "Launch Tuesday: target Wednesday.",
    })
    await store.notes.search({
      root: parseLucene("launch*", { defaultField: "text" }).root,
      folderIds: [folderId],
      limit: 1,
    })
    const accountId = await store.accounts.saveAccount(
      { provider: "email", account: "example-work" },
      { name: "Example mail" },
    )
    await store.mail.saveThread({
      accountId,
      externalId: "invented-context-thread",
      now: now - 2 * 86400000,
      emails: [
        {
          externalId: "invented-context-letter",
          subject: "Launch update",
          from: { name: "Alice Example", address: "alice@example.test" },
          sentAt: now - 2 * 86400000,
          bodyText: "Launch Monday: target Tuesday.",
        },
      ],
    })
    await store.mail.search("launch", { accountId, limit: 1 })
  } finally {
    await store.close()
  }
  const configured = [
    { id: "messages", kind: "message", provider: "example-messenger", account: "ExampleWork" },
    { id: "mail", kind: "mail", provider: "email", account: "example-work" },
    { id: "files", kind: "document", provider: "folder", account: `notes:${folderId}` },
  ].map((source) => ({ ...source, profile: "AliceExample" }))
  const capture = captureContextSources(configured, "AliceExample")
  let closes = 0
  const read = createZoomPreparationReader({
    ...readOptions,
    context: () => capture,
    connect: async (context) => {
      const connection = await connector({
        profile: "AliceExample",
        externalId: key.account,
        intent: "preparation",
        context,
      })
      return {
        ...connection,
        close: async () => {
          await connection.close()
          closes++
        },
      }
    },
  })
  const digest = () => createHash("sha256").update(readFileSync(path)).digest("hex"),
    before = digest()
  const input = { series_id: "123", communications: { sources: capture.ids.map((id) => ({ id })), query: "launch" } }
  const answer = await readMeetingPreparation(read, input, undefined, now)
  assert.equal(closes, 1)
  const section = answer.item.communications
  assert.deepEqual(
    section.items.map((item) => item.text),
    ["Launch Friday: target Monday.", "Launch Monday: target Tuesday.", "Launch Tuesday: target Wednesday."],
  )
  assert.equal(new Set(section.items.map((item) => item.ref)).size, 3)
  assert.deepEqual(
    section.coverage.sources.map((source) => source.state),
    ["searched", "searched", "searched"],
  )
  assert.ok(!JSON.stringify(section).includes("ExampleUnselected"))
  const projected = projectFields(answer, ["communications.items.ref"])
  assert.deepEqual(projected.item.communications.coverage, section.coverage)
  assert.equal(digest(), before)
  const mcp = await callMeetingPreparationTool(read, input, undefined, {}, now, { communications: true })
  assert.notEqual(mcp.isError, true)
  assert.deepEqual(mcp.structuredContent.item.communications, section)
  assert.equal(closes, 2)
  assert.equal(digest(), before)
  return {
    cited_communications: true,
    conflicting_statements_preserved: true,
    communications_projection: true,
    communications_no_writes: true,
  }
}
