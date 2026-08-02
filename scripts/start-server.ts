#!/usr/bin/env node
/**
 * This script MUST be executed with Node.js (not bun or other runtimes).
 * Using bun or other runtimes may cause terminal functionality issues due to the node-pty library,
 * which is a native module that requires Node.js and is not compatible with bun or other runtimes.
 * Node.js version must be 24 or higher.
 * Run with: node scripts/start-server.ts
 */
import path from 'node:path'
import { launchStandaloneServer } from '#/server/standalone/standalone-launch.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
await launchStandaloneServer({
  repoRoot,
  runtimeEntryDir: path.join(repoRoot, 'src/server/entrypoints'),
})
