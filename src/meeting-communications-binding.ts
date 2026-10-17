import { CliError } from "@wirecat/cli-base"
import type { MeetingOwner } from "@wirecat/cli-core/meetings"
import type { ContextSource } from "@wirecat/cli-core/services"
import * as v from "valibot"
import { type ConfiguredContextSource, contextSourcesSchema } from "./context-sources.js"

type Selection = { id: string; source: ContextSource }
export type ContextMetadata = {
  storedAccount(key: MeetingOwner): Promise<MeetingOwner & { id: number; name: string | null }>
  accountById(id: number): Promise<MeetingOwner | null>
}
export interface ContextCapture {
  readonly ids: readonly string[]
  assert(ids: readonly string[]): void
  resolve(metadata: ContextMetadata): Promise<readonly Selection[]>
}

export const captureContextSources = (
  configured: readonly ConfiguredContextSource[] | undefined,
  profile: string | null | undefined,
): ContextCapture => {
  const parsed = v.safeParse(contextSourcesSchema, configured ?? [])
  if (!parsed.success) throw new CliError("configuration_error", "context_sources is invalid")
  const definitions = parsed.output.filter((s) => s.profile === profile).map((s) => Object.freeze({ ...s }))
  const ids = Object.freeze(definitions.map((s) => s.id))
  let captured: Promise<readonly Selection[]> | undefined
  return Object.freeze({
    ids,
    assert(requested: readonly string[]) {
      if (!ids.length)
        throw new CliError(
          "configuration_error",
          "configure context.sources for the selected profile before requesting communications",
        )
      for (const id of requested)
        if (!ids.includes(id))
          throw new CliError("validation_error", `communications.sources contains an unauthorized selection: ${id}`)
    },
    resolve(metadata: ContextMetadata) {
      captured ??= (async () => {
        const selections: Selection[] = []
        for (const definition of definitions) {
          try {
            let folderId: number | undefined
            let key = { provider: definition.provider, account: definition.account }
            const folder = definition.account.match(/^notes:([1-9]\d*)$/)
            if (definition.kind === "document" && definition.provider === "folder" && folder) {
              const id = Number(folder[1])
              if (!Number.isSafeInteger(id)) throw new Error("invalid folder")
              folderId = id
              const found = await metadata.accountById(id)
              if (found?.provider !== "folder") throw new Error("missing folder")
              key = found
            }
            const account = await metadata.storedAccount(key)
            if (
              !Number.isSafeInteger(account.id) ||
              account.id < 1 ||
              account.provider !== key.provider ||
              account.account !== key.account ||
              (folderId !== undefined && account.id !== folderId)
            )
              throw new Error("scope mismatch")
            selections.push(
              Object.freeze({
                id: definition.id,
                source: Object.freeze({
                  kind: definition.kind,
                  accountId: account.id,
                  provider: account.provider,
                  account: account.account,
                }),
              }),
            )
          } catch {
            throw new CliError(
              "configuration_error",
              `configured context source ${definition.id} is unavailable; check its stored provider/account identity`,
            )
          }
        }
        return Object.freeze(selections)
      })().catch((error) => {
        captured = undefined
        throw error
      })
      return captured
    },
  })
}
