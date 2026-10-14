import type { Effects } from "@wirecat/cli-base/standards"
import { failureContext } from "@wirecat/cli-core"
import { judgedEffects, judgedTargets } from "@wirecat/cli-core/cli"
import type { Command } from "commander"

export const hostFailureContext = (registry?: Command, effects?: Effects) => ({
  ...failureContext(),
  ...(effects ? { effects: judgedEffects(effects) } : {}),
  ...(registry ? { targets: judgedTargets(registry) } : {}),
})
