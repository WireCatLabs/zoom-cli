#!/usr/bin/env node
import { enableCompileCache } from "node:module"

// Static imports would compile before this call; loading the program after it lets later runs reuse the cache.
enableCompileCache()
await import("./main.js")
