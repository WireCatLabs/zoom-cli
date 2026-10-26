import { type ConfigIssue, checkConfigText } from "@wirecat/cli-core/cli"
import type * as v from "valibot"

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

/** A problem with the whole file, which no `config unset` can fix. */
export const fileIssue = (file: string, what: string): LocatedIssue => ({ kind: "invalid_value", file, what, at: [] })

/**
 * Where the issue sits in the file, cut to what `config unset` removes: a whole top-level setting, so a broken part
 * of `context_sources` removes the list. A key the file holds as written wins over cutting it at a dot.
 */
const pathOf = (raw: Node, { profile, key }: ConfigIssue): string[] => {
  if (key === undefined) return []
  if (profile !== undefined) {
    const entry = isNode(raw.profiles) ? raw.profiles[profile] : undefined
    const permission = key.startsWith("permissions.") && !(isNode(entry) && Object.hasOwn(entry, key))
    return permission
      ? ["profiles", profile, "permissions", key.slice("permissions.".length)]
      : ["profiles", profile, key]
  }
  if (Object.hasOwn(raw, key)) return [key]
  if (key.startsWith("profiles.")) return ["profiles", key.slice("profiles.".length)]
  return [key.split(".")[0] as string]
}

/** The shared issue in zm's words: the setting names `config set` takes, and a fix that removes the whole setting. */
const inZmTerms = (raw: Node, issue: ConfigIssue): LocatedIssue => {
  const { fix: _, key: shared, ...rest } = issue
  const at = pathOf(raw, issue)
  const [first] = at
  if (shared === undefined || first === undefined) return { ...rest, at }
  const key = first === "profiles" ? shared : (SETTING_NAMES[first] ?? first)
  const named = key + shared.slice(first === "profiles" ? shared.length : first.length)
  const fixable = [key, issue.profile ?? ""].every((word) => SHELL_SAFE.test(word))
  return {
    ...rest,
    kind: issue.kind === "missing_setting" ? "invalid_value" : issue.kind,
    key,
    what: issue.what.replace(`setting ${shared}`, `setting ${named}`),
    ...(fixable ? { fix: `zm${issue.profile === undefined ? "" : ` ${issue.profile}`} config unset ${key}` } : {}),
    at,
  }
}

/**
 * Every problem in the file's text, one per part `config unset` removes, and the file as written — `null` when it is
 * not a JSON object and nothing in it can be changed. `permissionKeys`: the command paths a permission may name.
 */
export const configIssues = (
  text: string,
  file: string,
  schema: v.GenericSchema,
  permissionKeys?: ReadonlySet<string>,
): { issues: LocatedIssue[]; raw: Node | null } => {
  const checked = checkConfigText(text, { file, tool: "zm", schema })
  const broken = checked.issues.find((issue) => issue.kind === "invalid_json")
  if (broken) return { issues: [{ ...broken, at: [] }], raw: null }
  const raw: unknown = JSON.parse(text)
  if (!isNode(raw)) return { issues: [fileIssue(file, "the file has to be an object, in braces")], raw: null }
  const found = new Map<string, LocatedIssue>()
  const add = (issue: LocatedIssue) => {
    const id = issue.at.join("\u0000")
    if (!found.has(id)) found.set(id, issue)
  }
  for (const issue of checked.issues) add(inZmTerms(raw, issue))
  if (permissionKeys) {
    // checkConfigText checks permission keys only in what loads, and a broken part of a setting leaves nothing loaded.
    const rest = JSON.stringify(withoutIssues(raw, [...found.values()]))
    for (const issue of checkConfigText(rest, { file, tool: "zm", schema, knownPermissions: permissionKeys }).issues)
      if (issue.kind === "unknown_permission") add(inZmTerms(raw, issue))
  }
  return { issues: [...found.values()], raw }
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
