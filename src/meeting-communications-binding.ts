import { CliError } from "@wirecat/cli-base"
import { isFolderProvider } from "@wirecat/cli-core"
import type { MeetingOwner } from "@wirecat/cli-core/meetings"
import type { ContextSource } from "@wirecat/cli-core/services"
import * as v from "valibot"
import { type ConfiguredContextSource, contextSourcesSchema } from "./context-sources.js"

type Selection = { id: string; source: ContextSource }
export type ContextMetadata = {
  storedAccount(key: MeetingOwner): Promise<MeetingOwner & { id: number }>
  accountById(id: number): Promise<MeetingOwner | null>
}
export interface ContextCapture {
  readonly ids: readonly string[]
  assert(ids: readonly string[]): void
  select(ids: readonly string[]): ContextCapture
  resolve(metadata: ContextMetadata): Promise<readonly Selection[]>
}

const resolveContextSource = async (
  definition: ConfiguredContextSource,
  metadata: ContextMetadata,
): Promise<Selection> => {
  try {
    let folderId: number | undefined
    let key = { provider: definition.provider, account: definition.account }
    const folder = definition.account.match(/^notes:([1-9]\d*)$/)
    if (definition.kind === "document" && isFolderProvider(definition.provider) && folder) {
      const id = Number(folder[1])
      if (!Number.isSafeInteger(id)) throw new Error("invalid folder")
      folderId = id
      const found = await metadata.accountById(id)
      if (!found || !isFolderProvider(found.provider)) throw new Error("missing folder")
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
    return Object.freeze({
      id: definition.id,
      source: Object.freeze({
        kind: definition.kind,
        accountId: account.id,
        provider: account.provider,
        account: account.account,
      }),
    })
  } catch {
    throw new CliError(
      "configuration_error",
      `configured context source ${definition.id} is unavailable; check its stored provider/account identity`,
    )
  }
}

export const captureContextSources = (
  configured: readonly ConfiguredContextSource[] | undefined,
  profile: string | null | undefined,
): ContextCapture => {
  const parsed = v.safeParse(contextSourcesSchema, configured ?? [])
  if (!parsed.success) throw new CliError("configuration_error", "context_sources is invalid")
  const definitions = parsed.output.filter((s) => s.profile === profile).map((s) => Object.freeze({ ...s }))
  const pinned = new Map<string, Promise<Selection>>()
  const capture = (selected: readonly ConfiguredContextSource[]): ContextCapture => {
    const ids = Object.freeze(selected.map((s) => s.id))
    let captured: Promise<readonly Selection[]> | undefined
    const assert = (requested: readonly string[]) => {
      if (!ids.length)
        throw new CliError(
          "configuration_error",
          "configure context.sources for the selected profile before requesting communications",
        )
      for (const id of requested)
        if (!ids.includes(id))
          throw new CliError("validation_error", `communications.sources contains an unauthorized selection: ${id}`)
    }
    return Object.freeze({
      ids,
      assert,
      select(requested: readonly string[]) {
        assert(requested)
        if (!requested.length) throw new CliError("validation_error", "select at least one communications source")
        return capture(selected.filter((definition) => requested.includes(definition.id)))
      },
      resolve(metadata: ContextMetadata) {
        captured ??= (async () => {
          const selections: Selection[] = []
          for (const definition of selected) {
            let pending = pinned.get(definition.id)
            if (!pending) {
              pending = resolveContextSource(definition, metadata).catch((error) => {
                pinned.delete(definition.id)
                throw error
              })
              pinned.set(definition.id, pending)
            }
            selections.push(await pending)
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
  return capture(definitions)
}
