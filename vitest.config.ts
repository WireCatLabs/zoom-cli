import { defineConfig } from "vitest/config"
export default defineConfig({
  // Oxc does not resolve package exports in tsconfig extends; TypeScript checks the project configs separately.
  tsconfig: "./node_modules/@wirecat/cli-base/config/tsconfig.base.json",
  test: {
    // Filesystem fault injection must also reach the shared native helpers.
    server: { deps: { inline: [/cli-core\/dist\/files\//, /cli-core\/dist\/speech\/wav\.js/] } },
    // Agents run suites side by side on 24 cores; one worker per core ran the machine out of memory (2026-10-11).
    maxWorkers: 4,
    globalSetup: ["scripts/testing/argv-setup.ts"],
    setupFiles: ["scripts/testing/temp-state.ts", "scripts/testing/argv-trace.ts"],
    sequence: { hooks: "stack" },
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/bin/zm.ts", "src/bin/main.ts"],
      thresholds: { lines: 97, functions: 94, statements: 97, branches: 90 },
    },
  },
})
