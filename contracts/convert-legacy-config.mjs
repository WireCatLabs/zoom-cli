// Test fixture adapter for the documented owner edit, never a product migration.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"

const [action, root, expectedFingerprint] = process.argv.slice(2)
assert.ok(action === "snapshot" || action === "convert")
assert.ok(root && basename(root).startsWith("wirecat-contract-"))
assert.equal(realpathSync(root), root)
assert.equal(process.cwd(), root)
assert.equal(process.env.HOME, root)
assert.equal(process.env.ZM_CONFIG_DIR, join(root, "ZM", "CONFIG"))
assert.equal(process.env.MESSAGING_STORE, join(root, "store.sqlite"))
const path = join(root, "ZM", "CONFIG", "config.json")
assert.ok(lstatSync(path).isFile())
assert.equal(realpathSync(path), path)
const before = readFileSync(path)
const mode = lstatSync(path).mode
const fingerprint = createHash("sha256").update(before).update(String(mode)).digest("hex")
if (action === "snapshot") {
  process.stdout.write(`${JSON.stringify({ fingerprint })}\n`)
} else {
  // The intervening refused candidate command must leave both bytes and permissions intact.
  assert.equal(fingerprint, expectedFingerprint)
  const config = JSON.parse(before.toString("utf8"))
  const keys = {
    clientId: "client_id",
    filesFolder: "files_folder",
    filesTimezone: "files_timezone",
    accountProfile: "account_profile",
    source: "source",
  }
  assert.ok(Object.hasOwn(config, "accountProfile"))
  const converted = {}
  for (const [key, value] of Object.entries(config)) {
    assert.ok(Object.hasOwn(keys, key), "unexpected previous config key")
    converted[keys[key]] = value
  }
  writeFileSync(path, `${JSON.stringify(converted, null, 2)}\n`)
  assert.equal(lstatSync(path).mode, mode)
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), converted)
  process.stdout.write(`${JSON.stringify({ converted: true, preserved_values: true, preserved_mode: true })}\n`)
}
