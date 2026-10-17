import { CliError } from "@wirecat/cli-base"
import * as v from "valibot"
import { profilePattern } from "./profile.js"

const fields = {
  id: v.pipe(v.string(), v.regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)),
  kind: v.picklist(["message", "mail", "document"]),
  provider: v.pipe(
    v.string(),
    v.check((s) => !!s.trim() && Buffer.byteLength(s) <= 128),
  ),
  account: v.pipe(
    v.string(),
    v.check((s) => !!s.trim() && Buffer.byteLength(s) <= 1024),
  ),
}
const selected = v.pipe(v.array(v.strictObject(fields)), v.maxLength(8))
export const contextSourcesSchema = v.pipe(
  v.array(v.strictObject({ ...fields, profile: v.pipe(v.string(), v.regex(profilePattern)) })),
  v.maxLength(64),
  v.check((entries) => {
    const ids = new Set<string>(),
      identities = new Set<string>(),
      counts = new Map<string, number>()
    for (const entry of entries) {
      const id = JSON.stringify([entry.profile, entry.id]),
        key = JSON.stringify([entry.profile, entry.kind, entry.provider, entry.account])
      const count = (counts.get(entry.profile) ?? 0) + 1
      if (ids.has(id) || identities.has(key) || count > 8) return false
      ids.add(id)
      identities.add(key)
      counts.set(entry.profile, count)
    }
    return true
  }),
)
export type ConfiguredContextSource = v.InferOutput<typeof contextSourcesSchema>[number]

export const replaceContextSources = (
  value: string,
  profile: string | null,
  existing: readonly ConfiguredContextSource[] = [],
) => {
  if (!profile) throw new CliError("configuration_error", "select account.profile before configuring context.sources")
  let input: unknown
  try {
    input = JSON.parse(value)
  } catch {
    throw new CliError("validation_error", "context.sources must be a JSON array")
  }
  const parsed = v.safeParse(selected, input)
  if (!parsed.success)
    throw new CliError(
      "validation_error",
      "context.sources needs at most eight unique source IDs with kind/provider/account; unknown fields are refused",
    )
  const combined = [...existing.filter((s) => s.profile !== profile), ...parsed.output.map((s) => ({ ...s, profile }))]
  const all = v.safeParse(contextSourcesSchema, combined)
  if (!all.success)
    throw new CliError(
      "validation_error",
      "context.sources contains duplicate IDs/identities or exceeds its profile limits",
    )
  return all.output
}
