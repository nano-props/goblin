import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, describe, expect, test } from 'vitest'
import { buildRemoteCommandInvocation, buildRemoteTerminalInvocation } from '#/system/ssh/commands.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

const originalPath = process.env.PATH
const originalPathExt = process.env.PATHEXT
const tempDirs: string[] = []
const testPosix = process.platform === 'win32' ? test.skip : test

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

  test('ignores non-executable ssh candidates on PATH', () => {
    const dir = path.join(os.tmpdir(), `goblin-ssh-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    mkdirSync(dir, { recursive: true })
    const candidate = path.join(dir, process.platform === 'win32' ? 'ssh.exe' : 'ssh')
    if (process.platform === 'win32') {
      mkdirSync(candidate)
    } else {
      writeFileSync(candidate, '#!/bin/sh\nexit 0\n')
      chmodSync(candidate, 0o644)
    }
    process.env.PATH = dir
    process.env.PATHEXT = '.EXE'

    const invocation = buildRemoteTerminalInvocation(target(), '/srv/repo', { cols: 80, rows: 24 })

    expect(invocation.command).toBe('ssh')
  })

  test('remote bootstrap script handles space paths and excludes copied tree children', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-bootstrap-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    const sourceRoot = path.join(dir, 'repo root')
    const targetRoot = path.join(dir, 'worktree root')
    mkdirSync(path.join(sourceRoot, 'config dir', '.git'), { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(path.join(sourceRoot, 'foo bar.txt'), 'space\n')
    writeFileSync(path.join(sourceRoot, 'config dir', 'app.json'), 'ok\n')
    writeFileSync(path.join(sourceRoot, 'config dir', 'debug.log'), 'skip\n')
    writeFileSync(path.join(sourceRoot, 'config dir', '.git', 'config'), 'skip git\n')

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'bootstrapRemoteWorktree',
      sourceRoot,
      targetRoot,
      copy: ['foo bar.txt', 'config dir'],
      symlink: [],
      hardlink: [],
      exclude: ['config dir/*.log'],
    })

    const result = await execa('bash', ['-lc', invocation.script])

    expect(result.stdout.split('\n')).toEqual(['GOBLIN_BOOTSTRAP_COPY foo bar.txt', 'GOBLIN_BOOTSTRAP_COPY config dir'])
    expect(readFileSync(path.join(targetRoot, 'foo bar.txt'), 'utf8')).toBe('space\n')
    expect(readFileSync(path.join(targetRoot, 'config dir', 'app.json'), 'utf8')).toBe('ok\n')
    expect(existsSync(path.join(targetRoot, 'config dir', 'debug.log'))).toBe(false)
    expect(existsSync(path.join(targetRoot, 'config dir', '.git', 'config'))).toBe(false)
  })

  testPosix('remote bootstrap script rejects sources under a symlink parent', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-bootstrap-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    const sourceRoot = path.join(dir, 'repo')
    const targetRoot = path.join(dir, 'worktree')
    const outside = path.join(dir, 'outside')
    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(outside, { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(path.join(outside, 'secret.txt'), 'secret\n')
    symlinkSync(outside, path.join(sourceRoot, 'linked-dir'), 'dir')

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'bootstrapRemoteWorktree',
      sourceRoot,
      targetRoot,
      copy: ['linked-dir/secret.txt'],
      symlink: [],
      hardlink: [],
      exclude: [],
    })

    const result = await execa('bash', ['-lc', invocation.script], { reject: false })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('bootstrap path uses symlink parent: linked-dir')
    expect(existsSync(path.join(targetRoot, 'linked-dir', 'secret.txt'))).toBe(false)
  })

  testPosix('remote bootstrap script rejects targets under a symlink parent', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-bootstrap-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    const sourceRoot = path.join(dir, 'repo')
    const targetRoot = path.join(dir, 'worktree')
    const outside = path.join(dir, 'outside')
    mkdirSync(path.join(sourceRoot, 'linked-dir'), { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(path.join(sourceRoot, 'linked-dir', 'secret.txt'), 'secret\n')
    symlinkSync(outside, path.join(targetRoot, 'linked-dir'), 'dir')

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'bootstrapRemoteWorktree',
      sourceRoot,
      targetRoot,
      copy: ['linked-dir/secret.txt'],
      symlink: [],
      hardlink: [],
      exclude: [],
    })

    const result = await execa('bash', ['-lc', invocation.script], { reject: false })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('bootstrap target path uses symlink parent: linked-dir')
    expect(existsSync(path.join(outside, 'secret.txt'))).toBe(false)
  })

  testPosix('readRemoteFile fails when the path is not a regular file', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-read-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    mkdirSync(dir, { recursive: true })

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'readRemoteFile',
      path: dir,
    })

    const result = await execa('bash', ['-lc', invocation.script], { reject: false })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain(`error: remote file is not readable: ${dir}`)
  })

  test('remote bootstrap script keeps setup output out of the marker stream', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-bootstrap-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    const sourceRoot = path.join(dir, 'repo')
    const targetRoot = path.join(dir, 'worktree')
    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    const setup = "printf 'GOBLIN_BOOTSTRAP_COPY spoofed\\n'; printf 'setup stderr\\n' >&2"

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'bootstrapRemoteWorktree',
      sourceRoot,
      targetRoot,
      copy: [],
      symlink: [],
      hardlink: [],
      exclude: [],
      setup,
    })

    const result = await execa('bash', ['-lc', invocation.script], { env: { SHELL: '/bin/sh' } })

    expect(result.stdout).toBe(`GOBLIN_BOOTSTRAP_SETUP ${setup}`)
    expect(result.stderr).toBe('')
  })

  test('remote bootstrap script rejects ambiguous paths before writing', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-bootstrap-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    const sourceRoot = path.join(dir, 'repo')
    const targetRoot = path.join(dir, 'worktree')
    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(path.join(sourceRoot, 'shared.local'), 'value\n')

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'bootstrapRemoteWorktree',
      sourceRoot,
      targetRoot,
      copy: ['*.local'],
      symlink: ['shared.local'],
      hardlink: [],
      exclude: [],
    })

    const result = await execa('bash', ['-lc', invocation.script], { reject: false })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('path matches multiple materialization modes: shared.local')
    expect(existsSync(path.join(targetRoot, 'shared.local'))).toBe(false)
  })

  test('remote bootstrap script ignores .git matches from globs', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-bootstrap-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    const sourceRoot = path.join(dir, 'repo')
    const targetRoot = path.join(dir, 'worktree')
    mkdirSync(path.join(sourceRoot, 'config', '.git'), { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(path.join(sourceRoot, 'config', 'app.json'), 'ok\n')
    writeFileSync(path.join(sourceRoot, 'config', '.git', 'config'), 'skip git\n')

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'bootstrapRemoteWorktree',
      sourceRoot,
      targetRoot,
      copy: ['config/*'],
      symlink: [],
      hardlink: [],
      exclude: [],
    })

    const result = await execa('bash', ['-lc', invocation.script])

    expect(result.stdout).toBe('GOBLIN_BOOTSTRAP_COPY config/app.json')
    expect(readFileSync(path.join(targetRoot, 'config', 'app.json'), 'utf8')).toBe('ok\n')
    expect(existsSync(path.join(targetRoot, 'config', '.git', 'config'))).toBe(false)
  })

  testPosix('remote bootstrap script fails when a materialization command fails', async () => {
    const dir = path.join(os.tmpdir(), `goblin-remote-bootstrap-test-${Date.now()}-${process.pid}`)
    tempDirs.push(dir)
    const sourceRoot = path.join(dir, 'repo')
    const targetRoot = path.join(dir, 'worktree')
    mkdirSync(sourceRoot, { recursive: true })
    mkdirSync(targetRoot, { recursive: true })
    writeFileSync(path.join(sourceRoot, 'a.txt'), 'a\n')
    chmodSync(targetRoot, 0o500)

    const invocation = buildRemoteCommandInvocation(target(), {
      type: 'bootstrapRemoteWorktree',
      sourceRoot,
      targetRoot,
      copy: ['a.txt'],
      symlink: [],
      hardlink: [],
      exclude: [],
    })

    try {
      const result = await execa('bash', ['-lc', invocation.script], { reject: false })

      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('failed to copy a.txt')
      expect(existsSync(path.join(targetRoot, 'a.txt'))).toBe(false)
    } finally {
      chmodSync(targetRoot, 0o700)
    }
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
