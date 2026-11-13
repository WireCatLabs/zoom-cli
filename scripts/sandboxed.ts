import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The bin moves zm's old folders on start, so a development run of it must never see the owner's home or keyring
// (it moved the owner's config once, 2026-11-13).
const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error("usage: node scripts/sandboxed.ts <command> [args…]")
  process.exit(2)
}
const home = mkdtempSync(join(tmpdir(), "zm-sandbox-"))
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(XDG_|ZM_)/.test(name)))
const run = spawnSync(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    // A throwaway HOME does not hide the keyring: D-Bus still reaches it.
    DBUS_SESSION_BUS_ADDRESS: "disabled:",
  },
})
rmSync(home, { recursive: true, force: true })
process.exit(run.status ?? 1)
