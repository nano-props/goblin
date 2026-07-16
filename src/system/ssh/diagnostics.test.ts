import { describe, expect, test, vi } from 'vitest'
import { classifySshFailure, testRemoteRepo } from '#/system/ssh/diagnostics.ts'
import type { RemoteCommandKind, RemoteCommandResult } from '#/system/ssh/commands.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'

const okShell: RemoteCommandResult = { ok: true, stdout: 'ok', stderr: '', message: 'ok', timedOut: false }

describe('classifySshFailure', () => {
  test('classifies connection reset during ssh handshake as handshake failure', () => {
    expect(
      classifySshFailure({
        ok: false,
        stdout: '',
        stderr:
          'kex_exchange_identification: read: Connection reset by peer\nConnection reset by 100.64.1.18 port 2222',
        message: 'Command failed with exit code 255',
        timedOut: false,
      }),
    ).toBe('handshake-failed')
  })

  test('keeps shell-failed for generic post-connect ssh errors', () => {
    expect(
      classifySshFailure({
        ok: false,
        stdout: '',
        stderr: 'remote command failed unexpectedly',
        message: 'Command failed with exit code 255',
        timedOut: false,
      }),
    ).toBe('shell-failed')
  })
})

describe('testRemoteRepo parallel stages', () => {
  const target: RemoteRepoTarget = {
    id: 'goblin+ssh://example/srv%2Frepo',
    alias: 'example',
    host: 'example.local',
    user: 'me',
    port: 22,
    remotePath: '/srv/repo',
    displayName: 'example:repo',
  }

  test('records actual stage outcomes instead of marking them skipped after a parallel failure', async () => {
    const run = vi.fn<(command: RemoteCommandKind) => Promise<RemoteCommandResult>>()
    run.mockImplementation(async (command) => {
      if (command.type === 'checkShell') return okShell
      if (command.type === 'checkGit') {
        return {
          ok: false,
          stdout: '',
          stderr: 'git: command not found',
          message: 'Command failed with exit code 127',
          timedOut: false,
        }
      }
      if (command.type === 'testDirectory')
        return { ok: true, stdout: 'dir', stderr: '', message: 'ok', timedOut: false }
      if (command.type === 'revParseTopLevel')
        return { ok: true, stdout: '/srv/repo', stderr: '', message: 'ok', timedOut: false }
      return { ok: false, stdout: '', stderr: '', message: 'unexpected command', timedOut: false }
    })

    const result = await testRemoteRepo(target, { run })

    expect(result.ok).toBe(false)
    expect(result.category).toBe('git-missing')
    const git = result.stages.find((s) => s.name === 'git')!
    const path = result.stages.find((s) => s.name === 'path')!
    const repo = result.stages.find((s) => s.name === 'repo')!
    expect(git.status).toBe('failed')
    expect(path.status).toBe('passed')
    expect(repo.status).toBe('passed')
  })

  test('accepts an ok shell marker when stdout has surrounding text', async () => {
    const run = vi.fn<(command: RemoteCommandKind) => Promise<RemoteCommandResult>>()
    run.mockImplementation(async (command) => {
      if (command.type === 'checkShell')
        return { ok: true, stdout: 'profile notice\nok\nready', stderr: '', message: 'ok', timedOut: false }
      if (command.type === 'checkGit')
        return { ok: true, stdout: '/usr/bin/git', stderr: '', message: 'ok', timedOut: false }
      if (command.type === 'testDirectory') return { ok: true, stdout: '', stderr: '', message: 'ok', timedOut: false }
      if (command.type === 'revParseTopLevel')
        return { ok: true, stdout: '/srv/repo', stderr: '', message: 'ok', timedOut: false }
      return { ok: false, stdout: '', stderr: '', message: 'unexpected command', timedOut: false }
    })

    const result = await testRemoteRepo(target, { run })

    expect(result.ok).toBe(true)
    expect(result.stages.find((stage) => stage.name === 'shell')?.status).toBe('passed')
  })
})
