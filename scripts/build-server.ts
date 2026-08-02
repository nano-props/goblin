#!/usr/bin/env bun
import { $ } from 'bun'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const outputDir = path.join(repoRoot, 'dist/server')
const mainEntry = path.join(repoRoot, 'src/server/entrypoints/main.ts')
const ptyWorkerEntry = path.join(repoRoot, 'src/server/entrypoints/pty-worker.ts')
const gCommandEntry = path.join(repoRoot, 'src/server/entrypoints/g-command.ts')

rmSync(outputDir, { recursive: true, force: true })
mkdirSync(outputDir, { recursive: true })

await $`bun build ${mainEntry} ${ptyWorkerEntry} ${gCommandEntry} --outdir ${outputDir} --target node --external node-pty`

for (const artifact of [
  path.join(outputDir, 'main.js'),
  path.join(outputDir, 'pty-worker.js'),
  path.join(outputDir, 'g-command.js'),
]) {
  if (!existsSync(artifact)) throw new Error(`Server build artifact missing: ${artifact}`)
}
