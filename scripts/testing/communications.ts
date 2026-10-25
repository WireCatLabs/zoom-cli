import { parseLucene } from "@wirecat/cli-base/query"
import { openStore } from "@wirecat/cli-core/store"
import { contractSeed } from "@wirecat/cli-core/testing"
import { setConfig } from "../../src/config.js"
import { now, preparationFixture } from "./preparation.js"

export const communicationsFixture = async () => {
  const f = await preparationFixture()
  const store = await openStore({ path: f.path, now: () => now - 86400000 })
  try {
    const seed = contractSeed(),
      chat = seed.chats[0],
      message = seed.messages.find((m) => m.chatId === chat?.id)
    if (!chat || !message) throw new Error("Missing invented message seed")
    for (const account of ["AliceExample", "BobSample"]) {
      const key = { provider: "example-messenger", account }
      await store.accounts.saveAccount(key, { name: account })
      await store.chats.saveChats(key, [chat])
      await store.messages.saveMessages(
        key,
        chat.id,
        [{ ...message, timestamp: new Date(now - 5 * 86400000).toISOString(), text: "Launch Friday: target Monday." }],
        { via: "history" },
      )
    }
    const folder = await store.notes.addFolder({ name: "Harbour reference files" })
    const { note: document } = await store.notes.saveFileNote({
      folderId: folder.id,
      path: "launch.md",
      title: "Launch update",
      text: "Launch Tuesday: target Wednesday.",
    })
    await store.notes.search({
      root: parseLucene("launch*", { defaultField: "text" }).root,
      folderIds: [folder.id],
      limit: 1,
    })
    const mailId = await store.accounts.saveAccount(
      { provider: "email", account: "example-mail" },
      { name: "Example work mail" },
    )
    await store.mail.saveThread({
      accountId: mailId,
      externalId: "invented-thread",
      now: now - 2 * 86400000,
      emails: [
        {
          externalId: "invented-letter",
          subject: "Launch update",
          from: { name: "Alice Example", address: "alice@example.test" },
          sentAt: now - 2 * 86400000,
          bodyText: "Launch Monday: target Tuesday.",
        },
      ],
    })
    await store.mail.search("launch", { accountId: mailId, limit: 1 })
    const sources = [
      { id: "work-messages", kind: "message", provider: "example-messenger", account: "AliceExample" },
      { id: "work-mail", kind: "mail", provider: "email", account: "example-mail" },
      { id: "project-files", kind: "document", provider: "local", account: `notes:${folder.id}` },
    ]
    setConfig(f.deps.configPath, "context.sources", JSON.stringify(sources), () => "AliceExample")
    return { ...f, sources, document }
  } finally {
    await store.close()
  }
}
