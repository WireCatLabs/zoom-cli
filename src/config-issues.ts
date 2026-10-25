import type { ConfigIssue, ConfigIssueKind } from "@wirecat/cli-core/cli"
import * as v from "valibot"

// cli-core 0.423.0 builds the same list in src/cli/config-issues.ts but exports only its types; this is zm's copy,
// cut to zm's file, where the settings sit at the top and each profile under `profiles`.

/** An issue with the path in the file that `config unset` removes. */
export interface LocatedIssue extends ConfigIssue {
  at: string[]
}

type Node = Record<string, unknown>
export const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** The name `config set` and `config unset` take for each setting the file keeps under another key. */
export const SETTING_NAMES: Readonly<Record<string, string>> = {
  client_id: "zoom.client_id",
  source: "source",
  files_folder: "files.folder",
  files_timezone: "files.timezone",
  context_sources: "context.sources",
  record: "record",
  keep_runs_for_days: "keep_runs_for_days",
}

const SHELL_SAFE = /^[A-Za-z0-9_.:@-]*$/

/** The profile, the setting `config unset` takes, and the part of the file it removes. */
const settingAt = (path: readonly string[]): { profile?: string; key?: string; at: string[] } => {
  const [first, profile, inProfile, permission] = path
  if (first === undefined) return { at: [] }
  if (first === "profiles" && profile !== undefined && inProfile !== undefined) {
    const end = inProfile === "permissions" && permission !== undefined ? 4 : 3
    return { profile, key: path.slice(2, end).join("."), at: path.slice(0, end) }
  }
  if (first === "profiles" && profile !== undefined) return { key: `profiles.${profile}`, at: path.slice(0, 2) }
  return { key: SETTING_NAMES[first] ?? first, at: [first] }
}

export const locate = (
  kind: ConfigIssueKind,
  path: readonly string[],
  file: string,
  what: (key: string | undefined) => string,
): LocatedIssue => {
  const { profile, key, at } = settingAt(path)
  // A fix runs exactly as written; a name a shell would split or expand gets none.
  const fixable = key !== undefined && [key, profile ?? ""].every((word) => SHELL_SAFE.test(word))
  return {
    kind,
    file,
    ...(profile === undefined ? {} : { profile }),
    ...(key === undefined ? {} : { key }),
    what: what(key),
    ...(fixable ? { fix: `zm${profile === undefined ? "" : ` ${profile}`} config unset ${key}` } : {}),
    at,
  }
}

/** Node prints `(line 3 column 5)`, older runtimes only `position 41`, and Bun neither. */
const placeOf = (message: string, text: string): { line?: number; column?: number } => {
  const said = /line (\d+) column (\d+)/.exec(message)
  if (said) return { line: Number(said[1]), column: Number(said[2]) }
  const position = /position (\d+)/.exec(message)
  if (!position) return {}
  const before = text.slice(0, Number(position[1])).split("\n")
  return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 }
}

export const parseConfigText = (text: string, file: string): { raw: unknown } | { issue: LocatedIssue } => {
  try {
    return { raw: JSON.parse(text) }
  } catch (error) {
    const place = placeOf(error instanceof Error ? error.message : "", text)
    const where = place.line === undefined ? "" : ` at line ${place.line}, column ${place.column}`
    return { issue: { kind: "invalid_json", file, ...place, what: `the file is not valid JSON${where}`, at: [] } }
  }
}

const pathOf = (issue: v.BaseIssue<unknown>): string[] => (issue.path ?? []).map((item) => String(item.key))

const isPermissionKey = (issue: v.BaseIssue<unknown>, at: readonly string[]) => {
  const last = issue.path?.at(-1)
  return at.at(-2) === "permissions" && last !== undefined && "origin" in last && last.origin === "key"
}

/** What a value has to be, never what it was: valibot's own messages quote the value. */
const ruleOf = (issue: v.BaseIssue<unknown>): string => {
  if (issue.message.startsWith("has to be ")) return issue.message
  if (issue.type === "picklist") return `has to be one of ${issue.expected}`
  if (issue.kind === "schema") return `has to be of type ${issue.expected}`
  return issue.expected === null ? "has a value it does not take" : `has to be ${issue.expected}`
}

const onePass = (raw: unknown, schema: v.GenericSchema, file: string): LocatedIssue[] => {
  const result = v.safeParse(schema, raw)
  if (result.success) return []
  return result.issues.map((issue) => {
    const at = pathOf(issue)
    if (isPermissionKey(issue, at)) return locate("unknown_permission", at, file, (key) => `${key} names no command`)
    if (issue.expected === "never")
      return locate("unknown_setting", at, file, (key) => `setting ${key} is not a setting of zm`)
    return locate("invalid_value", at, file, (key) => `setting ${key} ${ruleOf(issue)}`)
  })
}

/** Every problem the schema finds: valibot names only the first unknown key of each object, so it passes again. */
export const schemaIssues = (raw: unknown, schema: v.GenericSchema, file: string): LocatedIssue[] => {
  const found = new Map<string, LocatedIssue>()
  for (;;) {
    const fresh = onePass(withoutIssues(raw, [...found.values()]), schema, file).filter(
      (issue) => !found.has(issue.at.join("\u0000")),
    )
    if (fresh.length === 0) return [...found.values()]
    for (const issue of fresh) found.set(issue.at.join("\u0000"), issue)
  }
}

/** A saved permission key no command checks would do nothing: one issue per key, in every profile. */
export const permissionIssues = (raw: unknown, known: ReadonlySet<string>, file: string): LocatedIssue[] => {
  if (!isNode(raw) || !isNode(raw.profiles)) return []
  return Object.entries(raw.profiles).flatMap(([profile, entry]) =>
    isNode(entry) && isNode(entry.permissions)
      ? Object.keys(entry.permissions)
          .filter((key) => !known.has(key))
          .map((key) =>
            locate(
              "unknown_permission",
              ["profiles", profile, "permissions", key],
              file,
              (setting) => `${setting} names no command`,
            ),
          )
      : [],
  )
}

/** The file without the parts the issues name: what still loads, and what `config unset` would leave. */
export const withoutIssues = (raw: unknown, issues: readonly LocatedIssue[]): unknown => {
  const copy = structuredClone(raw)
  for (const { at } of issues) removeAt(copy, at)
  return copy
}

export const removeAt = (raw: unknown, at: readonly string[]): void => {
  const parent = at.slice(0, -1).reduce<unknown>((node, key) => (isNode(node) ? node[key] : undefined), raw)
  if (isNode(parent)) delete parent[at.at(-1) as string]
}

export const publicIssue = ({ at: _, ...issue }: LocatedIssue): ConfigIssue => issue

/** One line for a command that refuses the file: the first problem, how to fix it, and how many more. */
export const issueMessage = (issues: readonly ConfigIssue[]): string => {
  const [first] = issues
  if (!first) return ""
  const more = issues.length - 1
  return (
    `${first.file}: ${first.what}` +
    (first.fix ? ` — remove it with \`${first.fix}\`` : "") +
    (more === 0 ? "" : ` (and ${more} more problem${more === 1 ? "" : "s"} — \`zm doctor\` lists them all)`)
  )
}
