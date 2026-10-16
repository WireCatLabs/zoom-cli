import { execFileSync } from "node:child_process"
import { closeSync, openSync, readSync, realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"

const safe = (value) => JSON.stringify(String(value))

export function releaseLockInfo(path, { run = execFileSync, realpath = realpathSync, label = readLabel } = {}) {
  const lines = [`another release holds ${safe(path)}`]
  let rows
  for (const columns of ["PID,COMMAND,PATH,TYPE,MODE,HOLDERS", "PID,COMMAND,PATH,TYPE,MODE"]) {
    try {
      const result = JSON.parse(
        run("lslocks", ["--json", "--output", columns], {
          encoding: "utf8",
          timeout: 2000,
          maxBuffer: 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        }),
      )
      rows = result.locks
      break
    } catch {
      // Older util-linux lacks HOLDERS; diagnostics also work without lslocks.
    }
  }
  const holders = new Set()
  if (Array.isArray(rows)) {
    for (const row of rows) {
      try {
        if (row.type !== "FLOCK" || row.mode?.endsWith("*")) continue
        if (realpath(row.path) !== realpath(path)) continue
        const before = holders.size
        if (Array.isArray(row.holders)) {
          for (const holder of row.holders) {
            const match = /^(\d+),([^,]+),\d+$/.exec(holder)
            if (match && Number(match[1]) > 0) holders.add(`pid ${match[1]} (${safe(match[2])})`)
          }
        }
        if (holders.size === before && Number.isInteger(row.pid) && row.pid > 0)
          holders.add(`pid ${row.pid} (${safe(row.command)})`)
      } catch {
        // A holder may exit while the snapshot is read, or hide its path.
      }
    }
  }
  lines.push(
    holders.size
      ? `Observed lock holders (may change): ${[...holders].join(", ")}`
      : "Observed lock holders: unavailable",
  )
  try {
    const recorded = label(`${path}.who`)
    if (recorded) lines.push(`Last recorded release (may be stale): ${safe(recorded)}`)
  } catch {
    // The label is advisory; only flock decides whether a release may proceed.
  }
  lines.push("Wait for the lock holders to finish, then retry. Do not remove the lock file.")
  return `${lines.join("\n")}\n`
}

function readLabel(path) {
  const fd = openSync(path, "r")
  try {
    const bytes = Buffer.alloc(512)
    return bytes.subarray(0, readSync(fd, bytes)).toString("utf8").trim()
  } finally {
    closeSync(fd)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.stderr.write(releaseLockInfo(process.argv[2]))
