const plain = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Turns snake_case input that agents send back, such as a cursor, into the camelCase the services take. */
export const camelKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(camelKeys)
  if (!plain(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase()),
      camelKeys(item),
    ]),
  )
}
