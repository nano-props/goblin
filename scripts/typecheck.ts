#!/usr/bin/env bun
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const HEARTBEAT_MS = 3_000
const PROJECTS = ['tsconfig.main.json', 'tsconfig.web.json', 'tsconfig.test.json'] as const
const tscBinCandidates =
  process.platform === 'win32'
    ? ['tsc.cmd', 'tsc.exe', 'tsc'].map((name) => path.join(repoRoot, 'node_modules', '.bin', name))
    : [path.join(repoRoot, 'node_modules', '.bin', 'tsc')]
const tscBin = tscBinCandidates.find((candidate) => existsSync(candidate)) ?? tscBinCandidates[0]
const bunBin = process.execPath

function runArchitectureCheck(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('[typecheck] [preflight] starting architecture boundary check')
    const child = spawn(bunBin, [path.join(repoRoot, 'scripts/check-architecture.ts')], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        console.log('[typecheck] [preflight] finished architecture boundary check')
        resolve()
        return
      }
      reject(
        new Error(`architecture boundary check failed with ${signal ? `signal ${signal}` : `exit code ${code ?? 1}`}`),
      )
    })
  })
}

function runTypeScript(project: (typeof PROJECTS)[number], index: number): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[typecheck] [${index + 1}/${PROJECTS.length}] starting ${project}`)
    const child = spawn(tscBin, ['--noEmit', '-p', project], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    const startedAt = Date.now()
    const heartbeat = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1_000)
      console.log(`[typecheck] [${index + 1}/${PROJECTS.length}] still running ${project} (${elapsedSec}s)`)
    }, HEARTBEAT_MS)
    child.on('error', (err) => {
      clearInterval(heartbeat)
      reject(err)
    })
    child.on('exit', (code, signal) => {
      clearInterval(heartbeat)
      if (code === 0) {
        console.log(`[typecheck] [${index + 1}/${PROJECTS.length}] finished ${project}`)
        resolve()
        return
      }
      reject(new Error(`tsc failed for ${project} with ${signal ? `signal ${signal}` : `exit code ${code ?? 1}`}`))
    })
  })
}

await runArchitectureCheck()

for (const [index, project] of PROJECTS.entries()) {
  await runTypeScript(project, index)
}

console.log('[typecheck] all projects passed')
