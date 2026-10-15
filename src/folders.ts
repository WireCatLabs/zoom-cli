/** The login lives in the keyring under the config folder's path, so it has to follow a moved folder. */
export const loginService = (configDir: string) => `zoom-cli:${configDir}`
