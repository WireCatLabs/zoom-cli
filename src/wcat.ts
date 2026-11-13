import type { ManifestIdentity } from "@wirecat/cli-base/wcat/manifest"
import { DESKTOP } from "./identity.js"
import { permissionKeyForPath } from "./permissions.js"

export const WCAT: ManifestIdentity = { ...DESKTOP, permissionOf: permissionKeyForPath }
