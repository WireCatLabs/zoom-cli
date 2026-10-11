import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    // Agents run suites side by side on 24 cores; one worker per core ran the machine out of memory (2026-10-11).
    maxWorkers: 4,
    globalSetup: ["scripts/testing/argv-setup.ts"],
    setupFiles: ["scripts/testing/argv-trace.ts"],
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/bin/zm.ts"],
      thresholds: { lines: 97, functions: 94, statements: 97, branches: 90 },
    },
  },
})
