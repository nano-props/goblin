import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { waitForMicrotaskCondition } from '#/test-utils/microtasks.ts'
import { advanceTimersAndFlush, useFakeTimers } from '#/test-utils/timers.ts'

const mocks = vi.hoisted(() => ({
  resolveWorkspaceFilesystemExecution: vi.fn(),
  buildCanonicalSshInvocation: vi.fn(),
  ensureSshControlDirectory: vi.fn(),
}))

vi.mock('#/server/modules/workspace-filesystem-execution.ts', () => ({
  resolveWorkspaceFilesystemExecution: mocks.resolveWorkspaceFilesystemExecution,
}))
vi.mock('#/system/ssh/invocation.ts', () => ({
  buildCanonicalSshInvocation: mocks.buildCanonicalSshInvocation,
  ensureSshControlDirectory: mocks.ensureSshControlDirectory,
}))
import { openWorkspaceFileDownload } from '#/server/modules/workspace-file-download.ts'

const target = {
  kind: 'workspace-root' as const,
  workspaceId: workspaceIdForTest('goblin+file:///tmp/download-workspace'),
  workspaceRuntimeId: 'workspace-runtime-download',
}
let root: string

function mockRemoteExecution(): void {
  mocks.resolveWorkspaceFilesystemExecution.mockResolvedValue({
    transport: 'remote',
    target,
    executionPath: root,
    worktree: null,
    remoteTarget: {
      id: workspaceIdForTest('goblin+ssh://example.test/workspace'),
      alias: 'example',
      host: 'example.test',
      user: 'test',
      port: 22,
      remotePath: root,
      displayName: 'example:workspace',
    },
    run: vi.fn(),
  })
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'goblin-download-'))
  mocks.resolveWorkspaceFilesystemExecution.mockResolvedValue({
    transport: 'local',
    target,
    executionPath: root,
    worktree: null,
  })
  mocks.ensureSshControlDirectory.mockResolvedValue(undefined)
})

afterEach(async () => {
  vi.clearAllMocks()
  await rm(root, { recursive: true, force: true })
})

describe('workspace file download', () => {
  test('streams local binary bytes', async () => {
    const bytes = new Uint8Array([0, 255, 128, 10, 0])
    await mkdir(path.join(root, 'fixtures'))
    await writeFile(path.join(root, 'fixtures', 'sample.bin'), bytes)

    const download = await openWorkspaceFileDownload(target, 'fixtures/sample.bin')

    expect(download.filename).toBe('sample.bin')
    expect(new Uint8Array(await new Response(download.stream).arrayBuffer())).toEqual(bytes)
  })

  test('rejects a path resolved outside the execution root', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'goblin-download-outside-'))
    try {
      await writeFile(path.join(outside, 'secret.txt'), 'private')
      await symlink(outside, path.join(root, 'linked'))

      await expect(openWorkspaceFileDownload(target, 'linked/secret.txt')).rejects.toMatchObject({
        message: 'error.invalid-path',
      })
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('rejects directories', async () => {
    await mkdir(path.join(root, 'folder'))
    await expect(openWorkspaceFileDownload(target, 'folder')).rejects.toMatchObject({
      message: 'error.file-download-regular-file-required',
    })
  })

  test.runIf(process.platform !== 'win32')('rejects a named pipe without waiting for a writer', async () => {
    await execa('mkfifo', [path.join(root, 'pipe')])

    await expect(openWorkspaceFileDownload(target, 'pipe')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'error.file-download-regular-file-required',
    })
  })

  test('reports a missing file as a client error', async () => {
    await expect(openWorkspaceFileDownload(target, 'missing.txt')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'error.file-not-found',
    })
  })

  test.runIf(process.platform !== 'win32')('streams remote binary bytes after the protocol marker', async () => {
    const bytes = new Uint8Array([0, 255, 128, 10, 0])
    await writeFile(path.join(root, 'sample.bin'), bytes)
    mockRemoteExecution()
    mocks.buildCanonicalSshInvocation.mockImplementation((_target, script) => ({
      command: 'sh',
      args: ['-c', script],
      script,
    }))

    const download = await openWorkspaceFileDownload(target, 'sample.bin')

    expect(new Uint8Array(await new Response(download.stream).arrayBuffer())).toEqual(bytes)
  })

  test.runIf(process.platform !== 'win32')('rejects remote login output before the protocol marker', async () => {
    await writeFile(path.join(root, 'sample.bin'), 'expected')
    mockRemoteExecution()
    mocks.buildCanonicalSshInvocation.mockImplementation((_target, script) => ({
      command: 'sh',
      args: ['-c', `printf profile-prefix; ${script}`],
      script,
    }))

    await expect(openWorkspaceFileDownload(target, 'sample.bin')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'error.file-download-protocol-invalid',
    })
  })

  test.runIf(process.platform !== 'win32')('classifies a remote protocol readiness timeout', async () => {
    useFakeTimers()
    mockRemoteExecution()
    mocks.buildCanonicalSshInvocation.mockReturnValue({
      command: 'sh',
      args: ['-c', 'exec sleep 60'],
      script: 'exec sleep 60',
    })

    const download = expect(openWorkspaceFileDownload(target, 'sample.bin')).rejects.toMatchObject({
      name: 'RemoteWorkspaceRuntimeFailureError',
      reason: 'timeout',
      workspaceId: target.workspaceId,
      workspaceRuntimeId: target.workspaceRuntimeId,
    })
    await waitForMicrotaskCondition(() => mocks.buildCanonicalSshInvocation.mock.calls.length === 1)
    await new Promise<void>((resolve) => setImmediate(resolve))
    await advanceTimersAndFlush(15_000)

    await download
  })
})
