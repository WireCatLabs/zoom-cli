const plain = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const deep =
  (name: (key: string) => string) =>
  (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(deep(name))
    if (!plain(value)) return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [name(key), deep(name)(item)]))
  }

export const snakeKeys = deep((key) => key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase())
export const camelKeys = deep((key) => key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase()))
