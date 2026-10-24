import { errorObjectOf, errorRecordOf, exitCodeOfError, type FailureContext, renderError } from "@wirecat/cli-base"
import type { Effects } from "@wirecat/cli-base/standards"
import { failureContext } from "@wirecat/cli-core"
import { judgedEffects, judgedTargets } from "@wirecat/cli-core/cli"
import type { Command } from "commander"
import { VERSION } from "./version.js"

export const hostFailureContext = (registry?: Command, effects?: Effects) => ({
  ...failureContext(),
  ...(effects ? { effects: judgedEffects(effects) } : {}),
  ...(registry ? { targets: judgedTargets(registry) } : {}),
})

export const reportFailure = (
  failure: unknown,
  args: readonly string[],
  deps: { diagnostic: (text: string) => void; outputIsTTY?: boolean },
  command = "zm",
  context: FailureContext = hostFailureContext(),
): number => {
  const end = args.indexOf("--")
  const flags = args.slice(0, end < 0 ? undefined : end)
  const machine = flags.some((word) => word === "--json" || word === "--jsonl")
  const object = errorObjectOf(failure, context)
  const record = flags.includes("--debug")
    ? errorRecordOf(failure, object, { command, service: "zm", version: VERSION })
    : undefined
  const interactive = deps.outputIsTTY === true && !machine
  deps.diagnostic(`${renderError(object, { cli: "zm", interactive, ...(record ? { record } : {}) })}\n`)
  return exitCodeOfError(object)
}
