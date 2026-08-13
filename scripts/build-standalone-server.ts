#!/usr/bin/env bun
import { $ } from 'bun'
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const outputDir = path.join(repoRoot, 'dist/standalone-server')
const standaloneEntry = path.join(repoRoot, 'src/server/entrypoints/standalone.ts')
const ptyWorkerEntry = path.join(repoRoot, 'src/server/entrypoints/pty-worker.ts')
const gCommandEntry = path.join(repoRoot, 'src/server/entrypoints/g-command.ts')
const bootstrapScript = path.join(repoRoot, 'src/system/ssh/remote-worktree-bootstrap.sh')
const downloadScript = path.join(repoRoot, 'src/system/ssh/remote-file-download.sh')
const gitOperationStateScript = path.join(repoRoot, 'src/system/ssh/remote-git-operation-state.sh')

rmSync(outputDir, { recursive: true, force: true })
mkdirSync(outputDir, { recursive: true })

await $`bun build ${standaloneEntry} ${ptyWorkerEntry} ${gCommandEntry} --outdir ${outputDir} --target node --external node-pty --external qrcode`
copyFileSync(bootstrapScript, path.join(outputDir, 'remote-worktree-bootstrap.sh'))
copyFileSync(downloadScript, path.join(outputDir, 'remote-file-download.sh'))
copyFileSync(gitOperationStateScript, path.join(outputDir, 'remote-git-operation-state.sh'))

const emittedStandaloneEntry = path.join(outputDir, 'standalone.js')
const mainEntry = path.join(outputDir, 'main.js')
renameSync(emittedStandaloneEntry, mainEntry)

for (const artifact of [
  mainEntry,
  path.join(outputDir, 'pty-worker.js'),
  path.join(outputDir, 'g-command.js'),
  path.join(outputDir, 'remote-worktree-bootstrap.sh'),
  path.join(outputDir, 'remote-file-download.sh'),
  path.join(outputDir, 'remote-git-operation-state.sh'),
]) {
  if (!existsSync(artifact)) throw new Error(`Standalone server build artifact missing: ${artifact}`)
}
