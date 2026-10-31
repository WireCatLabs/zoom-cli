import { PassThrough } from "node:stream"
import { Client, ReadBuffer, serializeMessage, type Transport } from "@modelcontextprotocol/client"
import type { ProgramDeps } from "../../src/program.js"
import { run } from "../../src/program.js"

const overStreams = (input: PassThrough, output: PassThrough): Transport => {
  const buffer = new ReadBuffer()
  const transport: Transport = {
    start: async () => {
      output.on("data", (chunk: Buffer) => {
        buffer.append(chunk)
        for (let message = buffer.readMessage(); message; message = buffer.readMessage()) transport.onmessage?.(message)
      })
    },
    send: async (message) => {
      input.write(serializeMessage(message))
    },
    close: async () => {
      input.end()
      transport.onclose?.()
    },
  }
  return transport
}

/** `zm <argv>` as an agent runs `mcp serve`, on streams of its own, with a connected client; `close` returns the exit code. */
export const mcpClient = async (deps: ProgramDeps, argv: string[] = ["work", "mcp", "serve"]) => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const diagnostic: string[] = []
  const serving = run(argv, { ...deps, stdin, stdout, diagnostic: (text) => diagnostic.push(text) })
  const client = new Client({ name: "test", version: "1.0.0" })
  const ended = serving.then((code) => {
    throw new Error(`mcp serve ended with ${code} before the client connected: ${diagnostic.join("")}`)
  })
  await Promise.race([client.connect(overStreams(stdin, stdout)), ended])
  ended.catch(() => {})
  return {
    client,
    diagnostic,
    close: async () => {
      await client.close()
      return serving
    },
  }
}
