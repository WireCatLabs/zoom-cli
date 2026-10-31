const SHARED_MCP =
  "cli-core's appMcpCommand; its own tests drive it, and src/mcp.test.ts runs zm's server, config, revoke, status and " +
  "refusals"
const LONG_RUNNING = `starts an HTTP server or a background process that runs until stopped; ${SHARED_MCP}`
const WRITES_CLIENT = `writes an agent client's own configuration or starts a child server; ${SHARED_MCP}`

export const UNTESTED: { command: string; option?: string; reason: string }[] = [
  ...[undefined, "--port", "--public-url", "--permission", "--profiles"].map((option) => ({
    command: "mcp server start",
    ...(option ? { option } : {}),
    reason: LONG_RUNNING,
  })),
  { command: "mcp server stop", reason: LONG_RUNNING },
  { command: "mcp server stop", option: "--profiles", reason: LONG_RUNNING },
  ...["--port", "--public-url"].map((option) => ({ command: "mcp serve", option, reason: LONG_RUNNING })),
  ...[undefined, "--allow-writes", "--permission"].map((option) => ({
    command: "mcp add",
    ...(option ? { option } : {}),
    reason: WRITES_CLIENT,
  })),
  ...[undefined, "--permission"].map((option) => ({
    command: "mcp check",
    ...(option ? { option } : {}),
    reason: WRITES_CLIENT,
  })),
  {
    command: "",
    option: "--version",
    reason: "Installed-package acceptance checks the actual bin version; Commander exits before preAction tracing.",
  },
  {
    command: "",
    option: "--help-all",
    reason:
      "first-screen.test.ts and the installed-package acceptance check it; Commander exits before preAction tracing.",
  },
]
