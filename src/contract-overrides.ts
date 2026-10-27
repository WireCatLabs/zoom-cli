import type { SharedContractOverride } from "@wirecat/cli-base/commands"

// Reviewed differences from Core. A changed default requires reviewing this declaration.
export const SHELL_OVERRIDES: Readonly<{
  skill: readonly SharedContractOverride[]
  doctor: readonly SharedContractOverride[]
  mcp: readonly SharedContractOverride[]
  search: readonly SharedContractOverride[]
}> = {
  skill: [
    {
      command: ["skill"],
      field: "effects",
      before: null,
      after: {
        remote: "none",
        local: "none",
      },
      reason:
        "Zoom installs its own meeting instructions through its source renderer and treats the packaged primary skill as effect-free.",
    },
    {
      command: ["skill", "show"],
      field: "examples",
      before: ["zm skill show", "zm skill show follow-ups"],
      after: ["zm skill show --json"],
      reason:
        "Zoom installs its own meeting instructions through its source renderer and treats the packaged primary skill as effect-free.",
    },
    {
      command: ["skill", "show"],
      field: "arguments",
      before: [
        {
          name: "name",
          required: false,
          variadic: false,
          description: "one of the skills shipped for a task: follow-ups, link-conversations",
        },
      ],
      after: [],
      reason:
        "Zoom installs its own meeting instructions through its source renderer and treats the packaged primary skill as effect-free.",
    },
    {
      command: ["skill", "install"],
      field: "examples",
      before: ["zm skill install --for agents"],
      after: ["zm skill install --for agents --json"],
      reason:
        "Zoom installs its own meeting instructions through its source renderer and treats the packaged primary skill as effect-free.",
    },
  ],
  doctor: [
    {
      command: ["doctor"],
      field: "description",
      before: "the state this installation is in, without connecting unless --online",
      after: "check local runtime and public config without a login or database",
      reason:
        "Zoom local diagnostics inspect runtime and public config only; online account checks belong to session status.",
    },
    {
      command: ["doctor"],
      field: "effects",
      before: {
        remote: "read",
        local: "read",
      },
      after: {
        remote: "none",
        local: "read",
      },
      reason:
        "Zoom local diagnostics inspect runtime and public config only; online account checks belong to session status.",
    },
    {
      command: ["doctor"],
      field: "runnable",
      before: true,
      after: null,
      reason:
        "Zoom local diagnostics inspect runtime and public config only; online account checks belong to session status.",
    },
    {
      command: ["doctor"],
      field: "options",
      before: [
        {
          flags: "--online",
          description: "also connect once and read the account; sends nothing",
          takes_value: false,
          mandatory: false,
        },
      ],
      after: [],
      reason:
        "Zoom local diagnostics inspect runtime and public config only; online account checks belong to session status.",
    },
    {
      command: ["doctor"],
      field: "children",
      before: ["reports"],
      after: [],
      reason:
        "Zoom local diagnostics inspect runtime and public config only; online account checks belong to session status.",
    },
    {
      command: ["doctor"],
      field: "examples",
      before: null,
      after: ["zm doctor --json"],
      reason:
        "Zoom local diagnostics inspect runtime and public config only; online account checks belong to session status.",
    },
  ],
  mcp: [
    {
      command: ["mcp"],
      field: "summary",
      before: "serve this profile's commands to an AI agent",
      after: null,
      reason:
        "Zoom serves meeting and archive commands over stdio under its selected profile; HTTP-specific options are unsupported.",
    },
    {
      command: ["mcp"],
      field: "description",
      before:
        "serve this profile to an agent over MCP, on stdin and stdout — `claude mcp add zm -- zm <profile> mcp`; with no profile, `zm mcp` serves every profile and each tool asks which",
      after:
        "serve zm's commands to an MCP agent over stdio, as the named profile allows them; with no profile, every profile",
      reason:
        "Zoom serves meeting and archive commands over stdio under its selected profile; HTTP-specific options are unsupported.",
    },
    {
      command: ["mcp"],
      field: "effects",
      before: {
        remote: "write",
        local: "write",
      },
      after: {
        remote: "read",
        local: "write",
      },
      reason:
        "Zoom serves meeting and archive commands over stdio under its selected profile; HTTP-specific options are unsupported.",
    },
    {
      command: ["mcp"],
      field: "runnable",
      before: true,
      after: null,
      reason:
        "Zoom serves meeting and archive commands over stdio under its selected profile; HTTP-specific options are unsupported.",
    },
    {
      command: ["mcp"],
      field: "options",
      before: [
        {
          flags: "--permission <key=level>",
          description:
            "make a permission stricter for this server only, like messages.send=deny; it never loosens the profile; repeat for more keys",
          takes_value: true,
          mandatory: false,
        },
        {
          flags: "--http",
          description:
            "serve over HTTP on 127.0.0.1 for ChatGPT and Claude in the browser, behind your tunnel; the profile's permissions decide",
          takes_value: false,
          mandatory: false,
        },
        {
          flags: "--port <port>",
          description: "the local port for --http (default 8765)",
          takes_value: true,
          mandatory: false,
        },
        {
          flags: "--public-url <url>",
          description:
            "the tunnel's https address the browser apps use, e.g. https://<name>.ts.net or https://<name>.ts.net/tg",
          takes_value: true,
          mandatory: false,
        },
        {
          flags: "--revoke",
          description: "forget every login given to a browser app; each must log in again",
          takes_value: false,
          mandatory: false,
        },
      ],
      after: [],
      reason:
        "Zoom serves meeting and archive commands over stdio under its selected profile; HTTP-specific options are unsupported.",
    },
    {
      command: ["mcp"],
      field: "children",
      before: ["server", "config", "add", "check"],
      after: [],
      reason:
        "Zoom serves meeting and archive commands over stdio under its selected profile; HTTP-specific options are unsupported.",
    },
    {
      command: ["mcp"],
      field: "examples",
      before: null,
      after: ["zm personal mcp"],
      reason:
        "Zoom serves meeting and archive commands over stdio under its selected profile; HTTP-specific options are unsupported.",
    },
  ],
  search: [
    {
      command: ["search"],
      field: "summary",
      before: "search the local archive",
      after: null,
      reason:
        "Zoom searches explicit local meeting and archive sources, with opt-in unified store reads rather than a live messenger backend.",
    },
    {
      command: ["search"],
      field: "description",
      before:
        "find things by text: one resource when you know it (messages, notes), or search all across messages and notes; for mail, the separate memo CLI: memo search mail",
      after: "opt-in shared store search; meetings by default",
      reason:
        "Zoom searches explicit local meeting and archive sources, with opt-in unified store reads rather than a live messenger backend.",
    },
    {
      command: ["search"],
      field: "children",
      before: ["all", "messages", "notes", "conversations", "runs"],
      after: ["all"],
      reason:
        "Zoom searches explicit local meeting and archive sources, with opt-in unified store reads rather than a live messenger backend.",
    },
    {
      command: ["search"],
      field: "effects",
      before: null,
      after: {
        remote: "none",
        local: "none",
      },
      reason:
        "Zoom searches explicit local meeting and archive sources, with opt-in unified store reads rather than a live messenger backend.",
    },
    {
      command: ["search", "all"],
      field: "summary",
      before: "search stored messages, notes and selected meeting transcripts",
      after: null,
      reason:
        "Zoom searches explicit local meeting and archive sources, with opt-in unified store reads rather than a live messenger backend.",
    },
    {
      command: ["search", "all"],
      field: "description",
      before:
        "search messenger messages and notes in the local store, and a meeting account's transcripts when --source names one — best match first; not mail (the separate memo CLI searches it: memo search mail), tasks, people, memories or projects. Use it when you do not know where something was written; search messages or notes reads one kind with all its fields",
      after: "search meetings and, with --only, messages, mail and notes in the local store",
      reason:
        "Zoom searches explicit local meeting and archive sources, with opt-in unified store reads rather than a live messenger backend.",
    },
    {
      command: ["search", "all"],
      field: "effects",
      before: {
        remote: "read",
        local: "read",
      },
      after: {
        remote: "none",
        local: "read",
      },
      reason:
        "Zoom searches explicit local meeting and archive sources, with opt-in unified store reads rather than a live messenger backend.",
    },
    {
      command: ["search", "all"],
      field: "examples",
      before: ["zm personal search all draft"],
      after: ['zm personal search all "example plan" --json'],
      reason:
        "Zoom searches explicit local meeting and archive sources, with opt-in unified store reads rather than a live messenger backend.",
    },
    {
      command: ["search", "all"],
      field: "arguments",
      before: [
        {
          name: "query",
          required: true,
          variadic: true,
          description: 'strict Lucene query: words, "phrases", AND/OR/NOT, field groups and date ranges',
        },
      ],
      after: [
        {
          name: "query",
          required: true,
          variadic: false,
          description: "words to find; a word also matches longer words it starts",
        },
      ],
      reason:
        "Zoom searches explicit local meeting and archive sources, with opt-in unified store reads rather than a live messenger backend.",
    },
    {
      command: ["search", "all"],
      field: "options",
      before: [
        {
          flags: "--only <resources>",
          description:
            "only these resources, separated by commas: messages, notes; meetings when --source names a meeting account",
          takes_value: true,
          mandatory: false,
        },
        {
          flags: "--source <accounts>",
          description:
            "only these accounts, separated by commas: provider:account as a hit shows it, a provider, a kind or group:<name>; each resource reads the ones of its kind, and meetings only when it names one",
          takes_value: true,
          mandatory: false,
        },
        {
          flags: "--max-meetings <n>",
          description:
            "how many of the meeting account's meetings to look through, newest first, or all for every one (default 100)",
          takes_value: true,
          mandatory: false,
        },
        {
          flags: "--limit <n>",
          description: "how many",
          takes_value: true,
          mandatory: false,
        },
        {
          flags: "--page <n>",
          description: "which page, starting at 1",
          takes_value: true,
          mandatory: false,
        },
        {
          flags: "--exact",
          description: "bare words and quotes match their exact form only, as exact:word does",
          takes_value: false,
          mandatory: false,
        },
        {
          flags: "--timezone <zone>",
          description: "the IANA timezone for calendar date boundaries",
          takes_value: true,
          mandatory: false,
        },
      ],
      after: [
        {
          flags: "--only <resources>",
          description: "comma-separated meetings,messages,mail,notes (default meetings)",
          takes_value: true,
          mandatory: false,
        },
        {
          flags: "--limit <n>",
          description: "how many results, 1 through 1000 (default 100)",
          takes_value: true,
          mandatory: false,
          default: 100,
        },
        {
          flags: "--page <n>",
          description: "which page, starting at 1",
          takes_value: true,
          mandatory: false,
        },
        {
          flags: "--max-meetings <n>",
          description: "most meetings to look through, newest first, or all (default 100)",
          takes_value: true,
          mandatory: false,
        },
        {
          flags: "--exact",
          description: "request exact matching; unsupported meeting queries are reported as skipped",
          takes_value: false,
          mandatory: false,
        },
      ],
      reason:
        "Zoom searches explicit local meeting and archive sources, with opt-in unified store reads rather than a live messenger backend.",
    },
  ],
}
