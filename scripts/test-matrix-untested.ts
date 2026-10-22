export const UNTESTED: { command: string; option?: string; reason: string }[] = [
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
  {
    command: "models audio download",
    reason: "It downloads hundreds of megabytes; cli-core's speech install tests cover the download and its sha256 check.",
  },
]
