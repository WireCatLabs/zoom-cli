import { afterEach } from "vitest"
import { addProfile } from "../../src/config.js"

export const TEST_PROFILE = "example-profile"

/** Makes the profile on this computer and names it for the process, as `ZM_PROFILE=<name> zm …` does. */
export const useProfile = (configPath: string, name = TEST_PROFILE, env: NodeJS.ProcessEnv = process.env): string => {
  addProfile(configPath, name)
  env.ZM_PROFILE = name
  return name
}

afterEach(() => {
  delete process.env.ZM_PROFILE
  delete process.env.ZM_PROFILE_LOCK
})
