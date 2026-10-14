import { PassThrough } from "node:stream"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { callMeetingTool, meetingSearchTool, meetingTools } from "@wirecat/cli-core/meetings/mcp"
import { memoryMeetingStore, sampleMeeting } from "@wirecat/cli-core/meetings/testing"
import { describe, expect, it, vi } from "vitest"
import { readAnswer } from "../scripts/testing/answers.js"
import { snakeKeys } from "./keys.js"
import { createMeetingMcpServer, type MeetingMcpOptions, serveMeetingMcp } from "./mcp-server.js"

const connected = async (options: MeetingMcpOptions) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createMeetingMcpServer(options)
  await server.connect(serverTransport)
  const client = new Client({ name: "invented-test-client", version: "1.0.0" })
  await client.connect(clientTransport)
  return { client, server }
}
const fixture = async () => {
  const store = memoryMeetingStore()
  const selected = await store.saveMeeting(sampleMeeting())
  const otherInput = sampleMeeting()
  otherInput.meeting.accountId = 2
  otherInput.meeting.title = "Other invented account"
  const other = await store.saveMeeting(otherInput)
  const close = vi.fn(async () => {})
  const connectStore = vi.fn(async () => ({ store, accountId: 1, close }))
  return { store, selected, other, close, connectStore }
}

describe("read-only SDK meeting server", () => {
  it("initializes and lists the shared read tools without opening a store", async () => {
    const fixtureData = await fixture()
    const { client, server } = await connected({ connectStore: fixtureData.connectStore, version: "example" })
    try {
      expect(client.getServerVersion()).toEqual({ name: "zoom-meetings", version: "example" })
      const { tools } = await client.listTools()
      expect(tools.map((tool) => tool.name)).toEqual([...meetingTools, meetingSearchTool].map((tool) => tool.name))
      for (const tool of tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true)
        expect(tool.inputSchema.properties).not.toHaveProperty("account_id")
      }
      expect(fixtureData.connectStore).not.toHaveBeenCalled()
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("uses the shared behavior for every tool and closes each read before the SDK reply", async () => {
    const data = await fixture()
    const { client, server } = await connected(data)
    try {
      const inputs = [
        ["meetings_list", {}],
        ["meeting_show", { meeting: data.selected.meeting.id }],
        ["meeting_transcript", { meeting: data.selected.meeting.id, history: true }],
        ["meeting_summary", { meeting: data.selected.meeting.id }],
        ["meeting_export", { meeting: data.selected.meeting.id, format: "markdown" }],
        ["meeting_people", { query: "Alice" }],
      ] as const
      for (const [name, args] of inputs) {
        const expected = await callMeetingTool(data.store, name, { ...args, account_id: 1 })
        const actual = await client.callTool({ name, arguments: args })
        const packet = JSON.parse(JSON.stringify(actual.structuredContent))
        const body = readAnswer(JSON.stringify(packet))
        const shared = JSON.parse(JSON.stringify(expected.structuredContent))
        if (name === "meeting_people") {
          expect(body.items).toEqual(snakeKeys(shared.items))
          expect(body.page).toEqual({ limit: Math.max(1, shared.limit), has_more: false })
        } else if ("item" in shared) expect(body).toEqual(shared.item)
        else if ("items" in shared) {
          const { meta: _meta, ...withoutMeta } = packet
          expect(withoutMeta).toEqual(shared)
        } else expect(body).toEqual(snakeKeys(shared))
        expect(actual.content).toEqual([{ type: "text", text: JSON.stringify(actual.structuredContent) }])
        expect(data.close).toHaveBeenCalledTimes(data.connectStore.mock.calls.length)
      }
      expect(data.connectStore).toHaveBeenCalledTimes(6)
      expect(
        await client.callTool({ name: "meeting_show", arguments: { meeting: data.other.meeting.id } }),
      ).toMatchObject({ isError: true, structuredContent: { error: { code: "not_found" } } })
      expect(data.close).toHaveBeenCalledTimes(7)
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("rejects missing, extra, invalid and account override arguments before opening", async () => {
    const data = await fixture()
    const { client, server } = await connected(data)
    try {
      for (const request of [
        { name: "meeting_show", arguments: {} },
        { name: "meeting_show", arguments: { meeting: 0 } },
        { name: "meetings_list", arguments: { extra: "invented" } },
        { name: "meetings_list", arguments: { account_id: 2 } },
        { name: "meeting_export", arguments: { meeting: 1, format: "csv" } },
        { name: "pull", arguments: {} },
      ])
        expect(await client.callTool(request)).toMatchObject({ isError: true })
      for (const [field, args] of [
        ["extra", { extra: "invented" }],
        ["account_id", { account_id: 2 }],
        ["limit", { limit: "invalid" }],
      ] as const) {
        const refused = await client.callTool({ name: "meetings_list", arguments: args })
        expect(refused).toMatchObject({
          isError: true,
          structuredContent: { error: { code: "validation_error", message: expect.stringContaining(field) } },
        })
      }
      expect(data.connectStore).not.toHaveBeenCalled()
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("sanitizes connection, read and close failures and never returns success before closing", async () => {
    const data = await fixture()
    const privateError = new Error("https://example.com/?token=private-example")
    const failingStore = {
      ...data.store,
      meeting: async () => {
        throw privateError
      },
    }
    const { client, server } = await connected({
      connectStore: vi
        .fn()
        .mockRejectedValueOnce(privateError)
        .mockResolvedValueOnce({ store: data.store, accountId: 0, close: data.close })
        .mockResolvedValueOnce({ store: failingStore, accountId: 1, close: data.close })
        .mockResolvedValueOnce({
          store: data.store,
          accountId: 1,
          close: async () => {
            throw privateError
          },
        })
        .mockResolvedValueOnce({
          get store() {
            throw privateError
          },
          accountId: 1,
          close: data.close,
        }),
    })
    try {
      for (let i = 0; i < 5; i++) {
        const result = await client.callTool({ name: "meeting_show", arguments: { meeting: 1 } })
        expect(result.isError).toBe(true)
        expect(JSON.stringify(result)).not.toContain("private-example")
      }
      expect(data.close).toHaveBeenCalledTimes(3)
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("waits for close settlement before sending a success response", async () => {
    const data = await fixture()
    let release!: () => void
    let closing!: () => void
    const enteredClose = new Promise<void>((resolve) => {
      closing = resolve
    })
    const { client, server } = await connected({
      connectStore: async () => ({
        store: data.store,
        accountId: 1,
        close: () => {
          closing()
          return new Promise<void>((resolve) => {
            release = resolve
          })
        },
      }),
    })
    try {
      let answered = false
      const response = client.callTool({ name: "meetings_list" }).then((result) => {
        answered = true
        return result
      })
      await enteredClose
      expect(answered).toBe(false)
      release()
      expect((await response).isError).not.toBe(true)
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("cannot override the selected account through inherited arguments normalized by the SDK", async () => {
    const data = await fixture()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const server = createMeetingMcpServer(data)
    await server.connect(serverTransport)
    try {
      const reply = new Promise<unknown>((resolve) => {
        clientTransport.onmessage = resolve
      })
      await clientTransport.start()
      await clientTransport.send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "meetings_list",
          arguments: Object.create({ account_id: 2 }),
        },
      })
      expect(await reply).toMatchObject({
        result: {
          structuredContent: {
            items: [
              {
                id: String(data.selected.meeting.id),
                ref: `meeting:1/${data.selected.meeting.id}`,
                provider: "memory",
                account: "1",
              },
            ],
          },
        },
      })
      expect(data.connectStore).toHaveBeenCalledTimes(1)
      expect(data.close).toHaveBeenCalledTimes(1)
    } finally {
      await server.close()
    }
  })

  it("connects the actual SDK stdio transport with injected streams", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const connectStore = vi.fn()
    const transport = new StdioServerTransport(input, output)
    const serving = serveMeetingMcp({ connectStore }, transport)
    try {
      const reply = new Promise<string>((resolve) => output.once("data", (chunk) => resolve(String(chunk))))
      input.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "invented", version: "1" },
          },
        })}\n`,
      )
      expect(JSON.parse(await reply)).toMatchObject({ result: { capabilities: { tools: {} } } })
      expect(connectStore).not.toHaveBeenCalled()
    } finally {
      await transport.close()
      await serving
    }
  })

  it("bounds actual UTF-8 serialized results after closing and validates the limit", async () => {
    for (const maxResultBytes of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => createMeetingMcpServer({ connectStore: vi.fn(), maxResultBytes })).toThrow(/nonnegative/)
    const data = await fixture()
    const input = sampleMeeting()
    input.meeting.title = "😀".repeat(50)
    await data.store.saveMeeting(input)
    const expected = await callMeetingTool(data.store, "meetings_list", { account_id: 1 })
    const chars = JSON.stringify(expected).length
    const { client, server } = await connected({ ...data, maxResultBytes: chars })
    try {
      const result = await client.callTool({ name: "meetings_list" })
      expect(result).toMatchObject({ isError: true, structuredContent: { error: { code: "validation_error" } } })
      expect(JSON.stringify(result)).not.toContain("😀")
      expect(data.close).toHaveBeenCalledTimes(1)
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("does not connect on prior abort and abort removes its listener after shutdown", async () => {
    const controller = new AbortController()
    controller.abort()
    const connectStore = vi.fn()
    await serveMeetingMcp({ connectStore, signal: controller.signal })
    const { client, server } = await connected({ connectStore, signal: controller.signal })
    try {
      expect(await client.callTool({ name: "meetings_list" })).toMatchObject({ isError: true })
      expect(connectStore).not.toHaveBeenCalled()
    } finally {
      await client.close()
      await server.close()
    }
    const active = new AbortController()
    const remove = vi.spyOn(active.signal, "removeEventListener")
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const serving = serveMeetingMcp({ connectStore, signal: active.signal }, serverTransport)
    const activeClient = new Client({ name: "invented", version: "1" })
    await activeClient.connect(clientTransport)
    active.abort()
    await serving
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
    await activeClient.close()
  })

  it("keeps in-flight connections alive during cancellation and waits for their closes", async () => {
    const data = await fixture()
    const controller = new AbortController()
    let release!: () => void
    let enter!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const store = {
      ...data.store,
      meetings: async () => {
        enter()
        await new Promise<void>((resolve) => {
          release = resolve
        })
        expect(data.close).not.toHaveBeenCalled()
        return [data.selected.meeting]
      },
    }
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    let finished = false
    const serving = serveMeetingMcp(
      { connectStore: async () => ({ store, accountId: 1, close: data.close }), signal: controller.signal },
      serverTransport,
    ).then(() => {
      finished = true
    })
    const client = new Client({ name: "invented", version: "1" })
    await client.connect(clientTransport)
    const response = client.callTool({ name: "meetings_list" }).catch(() => null)
    await entered
    controller.abort()
    expect(finished).toBe(false)
    expect(data.close).not.toHaveBeenCalled()
    release()
    await serving
    await response
    expect(data.close).toHaveBeenCalledTimes(1)
    await client.close()
  })

  it("ends default stdio on EOF without reading the process input", async () => {
    const input = new PassThrough()
    const mocked = vi.spyOn(process, "stdin", "get").mockReturnValue(input as unknown as typeof process.stdin)
    const connectStore = vi.fn()
    try {
      const serving = serveMeetingMcp({ connectStore })
      input.end()
      await serving
      expect(input.listenerCount("end")).toBe(0)
      expect(input.listenerCount("data")).toBe(0)
      expect(connectStore).not.toHaveBeenCalled()
    } finally {
      mocked.mockRestore()
    }
  })

  it("preserves a transport initialization error when cleanup also fails", async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, "removeEventListener")
    const close = vi.fn(async () => {
      throw new Error("invented close failure")
    })
    await expect(
      serveMeetingMcp(
        { connectStore: vi.fn(), signal: controller.signal },
        {
          start: async () => {
            throw new Error("invented start failure")
          },
          close,
          send: async () => {},
        },
      ),
    ).rejects.toThrow("invented start failure")
    expect(close).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
  })

  it("waits for a pending transport start after abort and preserves a failed start", async () => {
    for (const fails of [false, true]) {
      const controller = new AbortController()
      let release!: () => void
      const close = vi.fn(async () => {})
      const serving = serveMeetingMcp(
        { connectStore: vi.fn(), signal: controller.signal },
        {
          start: async () => {
            await new Promise<void>((resolve) => {
              release = resolve
            })
            if (fails) throw new Error("invented pending start failure")
          },
          close,
          send: async () => {},
        },
      )
      controller.abort()
      expect(close).not.toHaveBeenCalled()
      release()
      if (fails) await expect(serving).rejects.toThrow("invented pending start failure")
      else await serving
      expect(close).toHaveBeenCalledTimes(1)
    }
  })

  it("closes a connection acquired after server cancellation without starting a read", async () => {
    const data = await fixture()
    const read = vi.spyOn(data.store, "meetings")
    const controller = new AbortController()
    let release!: () => void
    let enter!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const connectStore = async () => {
      enter()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { store: data.store, accountId: 1, close: data.close }
    }
    const { client, server } = await connected({ connectStore, signal: controller.signal })
    try {
      const result = client.callTool({ name: "meetings_list" })
      await entered
      controller.abort()
      release()
      expect(await result).toMatchObject({ isError: true, structuredContent: { error: { code: "cancelled" } } })
      expect(read).not.toHaveBeenCalled()
      expect(data.close).toHaveBeenCalledTimes(1)
    } finally {
      await client.close()
      await server.close()
    }
  })

  it("honors SDK request cancellation during connection and reads without closing an active read", async () => {
    for (const stage of ["connect", "read"] as const) {
      const data = await fixture()
      const controller = new AbortController()
      let release!: () => void
      let enter!: () => void
      let closed!: () => void
      const entered = new Promise<void>((resolve) => {
        enter = resolve
      })
      const closedRead = new Promise<void>((resolve) => {
        closed = resolve
      })
      const wait = async () => {
        enter()
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      const read = vi.fn(async () => {
        if (stage === "read") await wait()
        return [data.selected.meeting]
      })
      const close = vi.fn(async () => {
        closed()
      })
      const { client, server } = await connected({
        connectStore: async () => {
          if (stage === "connect") await wait()
          return { store: { ...data.store, meetings: read }, accountId: 1, close }
        },
      })
      try {
        const response = client
          .callTool({ name: "meetings_list" }, undefined, { signal: controller.signal })
          .catch(() => null)
        await entered
        controller.abort(new Error("invented cancellation"))
        await response
        expect(close).not.toHaveBeenCalled()
        release()
        await closedRead
        expect(read).toHaveBeenCalledTimes(stage === "read" ? 1 : 0)
        expect(close).toHaveBeenCalledTimes(1)
      } finally {
        await client.close()
        await server.close()
      }
    }
  })

  it("allows explicit unlimited result output", async () => {
    const data = await fixture()
    const { client, server } = await connected({ ...data, maxResultBytes: 0 })
    try {
      expect(await client.callTool({ name: "meetings_list" })).not.toHaveProperty("isError", true)
    } finally {
      await client.close()
      await server.close()
    }
  })
})
