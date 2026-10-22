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
]
