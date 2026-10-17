import type { Effects } from "@wirecat/cli-base/standards"
import { FETCH, LOCAL_READ, LOCAL_WRITE, NO_EFFECTS, REMOTE_READ, REMOTE_WRITE } from "@wirecat/cli-core/cli"
import type { Command } from "commander"

/** Flags can enable extra effects, so discovery declares the broadest supported invocation. */
export const commandEffects = (command: Command): Effects | undefined => {
  const parts: string[] = []
  for (let current = command; current.parent; current = current.parent) parts.unshift(current.name())
  const path = parts.join(" ")
  if (command.commands.length || ["commands", "complete"].includes(path)) return NO_EFFECTS
  if (["config show", "doctor", "skill show"].includes(path)) return LOCAL_READ
  if (
    [
      "meetings list",
      "meetings show",
      "meetings transcript",
      "meetings summary",
      "meetings people",
      "meetings events list",
      "events list",
      "meetings passage",
      "meetings projects evidence",
    ].includes(path)
  )
    return LOCAL_READ
  if (["config set", "skill install", "meetings import", "meetings export"].includes(path)) return LOCAL_WRITE
  if (["meetings prepare", "session status", "recordings list", "recordings show"].includes(path)) return REMOTE_READ
  if (["watch", "meetings sync", "search meetings", "meetings embeddings"].includes(path)) return FETCH
  if (["recordings download", "recordings sync", "recordings schedule run"].includes(path)) return FETCH
  if (path.startsWith("remote-meetings "))
    return ["list", "show", "invitation"].includes(command.name()) ? REMOTE_READ : REMOTE_WRITE
  return undefined
}
