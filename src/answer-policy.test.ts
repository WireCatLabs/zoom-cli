import { CliError, errorObjectOf } from "@wirecat/cli-base"
import { annotate } from "@wirecat/cli-base/commands"
import { FETCH, LOCAL_READ, LOCAL_WRITE, REMOTE_WRITE } from "@wirecat/cli-core/cli"
import { Command } from "commander"
import { expect, it } from "vitest"
import { hostFailureContext } from "./answer-policy.js"
import { meetingAnswer, readMetadata } from "./answers.js"

it("uses shared retry policy for reads, fetches, local writes and uncertain remote writes", () => {
  const failure = new CliError("network_error", "example transport failure")
  for (const effects of [LOCAL_READ, FETCH, LOCAL_WRITE])
    expect(errorObjectOf(failure, hostFailureContext(undefined, effects)).error.retry.safe).toBe(true)
  expect(errorObjectOf(failure, hostFailureContext(undefined, REMOTE_WRITE)).error.retry.safe).toBe(false)
  expect(
    errorObjectOf(new CliError("outcome_unknown", "example"), hostFailureContext(undefined, FETCH)).error.retry.safe,
  ).toBe(false)
})

it("checks suggested steps against mounted commands and the shared effects policy", () => {
  const root = new Command("zm")
  for (const [name, effects] of [
    ["read", LOCAL_READ],
    ["fetch", FETCH],
    ["write", LOCAL_WRITE],
    ["remote", REMOTE_WRITE],
  ] as const)
    annotate(root.command(name), { origin: "handwritten", effects })
  const next = ["read", "fetch", "write", "remote", "missing"].map((command) => ({
    kind: "command",
    step: "page.next",
    command,
    args: {},
    why: "example next step",
    safe_to_auto_execute: true,
  }))
  const safety = next.map((step) => {
    const packet = meetingAnswer({ item: {}, next: [step] }, readMetadata(() => 0)(), root)
    return packet.next?.[0]?.safe_to_auto_execute
  })
  expect(safety).toEqual([true, true, false, false, undefined])
})

it("preserves source issues and partial completeness while assigning host metadata", () => {
  const host = readMetadata(() => 0)()
  const packet = meetingAnswer({ item: {}, meta: { issues: [{ code: "network_error", source: "meetings" }] } }, host)
  expect(packet.meta).toMatchObject({
    ...host,
    complete: false,
    issues: [{ code: "network_error", source: "meetings" }],
  })
})
