#!/usr/bin/env bun
import { $ } from 'bun'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const outputDir = path.join(repoRoot, 'dist/standalone-server')
const standaloneEntry = path.join(repoRoot, 'src/server/entrypoints/standalone.ts')
const ptyWorkerEntry = path.join(repoRoot, 'src/server/entrypoints/pty-worker.ts')
const gCommandEntry = path.join(repoRoot, 'src/server/entrypoints/g-command.ts')

rmSync(outputDir, { recursive: true, force: true })
mkdirSync(outputDir, { recursive: true })

await $`bun build ${standaloneEntry} ${ptyWorkerEntry} ${gCommandEntry} --outdir ${outputDir} --target node --external node-pty --external qrcode`

const emittedStandaloneEntry = path.join(outputDir, 'standalone.js')
const mainEntry = path.join(outputDir, 'main.js')
renameSync(emittedStandaloneEntry, mainEntry)

for (const artifact of [mainEntry, path.join(outputDir, 'pty-worker.js'), path.join(outputDir, 'g-command.js')]) {
  if (!existsSync(artifact)) throw new Error(`Standalone server build artifact missing: ${artifact}`)
}
