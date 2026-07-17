#!/usr/bin/env bun
import path from 'node:path'
import { omit } from 'es-toolkit'
import { prepareNodePtyDarwinRuntime } from '#/system/node-pty-runtime.ts'

const repoRoot = path.resolve(import.meta.dirname, '..')
prepareNodePtyDarwinRuntime({ packageRoot: path.join(repoRoot, 'node_modules/node-pty') })

const electron = path.join(repoRoot, 'node_modules', '.bin', `electron${process.platform === 'win32' ? '.cmd' : ''}`)
const electronProcess = Bun.spawn([electron, '.', ...Bun.argv.slice(2)], {
  cwd: repoRoot,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
  env: omit(Bun.env, ['ELECTRON_RUN_AS_NODE']),
})

process.exitCode = await electronProcess.exited
