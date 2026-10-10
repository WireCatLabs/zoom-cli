import { appendFileSync } from "node:fs"
import { Command } from "commander"

const original = Command.prototype.parseAsync
const traced = new WeakSet<Command>()
Command.prototype.parseAsync = function (...args: Parameters<Command["parseAsync"]>) {
  if (this.name() === "zm" && !traced.has(this)) {
    traced.add(this)
    this.hook("preAction", (_root, action) => {
      const path: string[] = []
      const options = new Set<string>()
      for (let at: Command | null = action; at; at = at.parent) {
        if (at.parent) path.unshift(at.name())
        for (const option of at.options)
          if (at.getOptionValueSource(option.attributeName()) === "cli") options.add(option.long ?? option.short ?? "")
      }
      const destination = process.env.ZM_TEST_ARGV_LOG
      if (destination)
        appendFileSync(destination, `${JSON.stringify({ command: path.join(" "), options: [...options] })}\n`)
    })
  }
  return original.apply(this, args)
}
