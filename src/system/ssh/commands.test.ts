import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { buildRemoteTerminalInvocation } from '#/system/ssh/commands.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

const originalPath = process.env.PATH
const originalPathExt = process.env.PATHEXT
const tempDirs: string[] = []

afterEach(() => {
  process.env.PATH = originalPath
  if (originalPathExt === undefined) delete process.env.PATHEXT
  else process.env.PATHEXT = originalPathExt
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('remote ssh command builders', () => {
  test('uses an ssh executable discovered on PATH', () => {
    const dir = path.join(os.tmpdir(), `goblin-ssh-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    mkdirSync(dir, { recursive: true })
    const executable = path.join(dir, process.platform === 'win32' ? 'ssh.exe' : 'ssh')
    writeFileSync(executable, '#!/bin/sh\nexit 0\n')
    if (process.platform !== 'win32') chmodSync(executable, 0o755)
    process.env.PATH = dir
    process.env.PATHEXT = '.EXE'

    const invocation = buildRemoteTerminalInvocation(target(), '/srv/repo', { cols: 80, rows: 24 })

    expect(invocation.command).toBe(executable)
  })

  test('falls back to the bare "ssh" name when no executable is on PATH', () => {
    process.env.PATH = path.join(os.tmpdir(), 'definitely-not-on-path-' + process.pid)
    delete process.env.PATHEXT

    const invocation = buildRemoteTerminalInvocation(target(), '/srv/repo', { cols: 80, rows: 24 })

    expect(invocation.command).toBe('ssh')
  })
})

function target(): RemoteRepoTarget {
  return {
    id: 'ssh-config://prod/srv/repo',
    alias: 'prod',
    host: 'example.test',
    user: 'deploy',
    port: 22,
    remotePath: '/srv/repo',
    displayName: 'prod:repo',
  }
}
