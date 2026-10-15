import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Model the user's explicit key rename between the refused old config and the store upgrade.
if (!process.env.WIRECAT_CONTRACT_DENIED || !process.env.ZM_CONFIG_DIR) throw new Error("contract only")
const path = join(process.env.ZM_CONFIG_DIR, "config.json")
const names = {
  clientId: "client_id",
  filesFolder: "files_folder",
  filesTimezone: "files_timezone",
  accountProfile: "account_profile",
  source: "source",
}
const old = JSON.parse(readFileSync(path, "utf8"))
const current = Object.fromEntries(
  Object.entries(old).map(([key, value]) => {
    if (!Object.hasOwn(names, key)) throw new Error("unexpected previous config key")
    return [names[key], value]
  }),
)
writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 })
process.stdout.write('{"renamed":true}\n')
