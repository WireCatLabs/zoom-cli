import { type Paths, resolvePaths } from "@wirecat/cli-base"

export const loginService = (configDir: string) => `zoom-cli:${configDir}`

export const zmPaths = (options: Pick<Parameters<typeof resolvePaths>[0], "env" | "platform"> = {}): Paths =>
  resolvePaths({ appName: "zm", ...options })
