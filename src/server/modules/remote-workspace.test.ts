import { beforeEach, describe, expect, test, vi } from 'vitest'
import { normalizeRemoteTarget } from '#/shared/remote-workspace.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const mocks = vi.hoisted(() => ({
  listSshConfigHosts: vi.fn(),
  makeUnresolvedTargetDiagnostic: vi.fn(),
  resolveRemoteTarget: vi.fn(),
  resolveTrackedRemoteTarget: vi.fn(),
  runRemoteCommand: vi.fn(),
  testRemoteWorkspace: vi.fn(),
}))

vi.mock('#/system/ssh/commands.ts', () => ({
  runRemoteCommand: mocks.runRemoteCommand,
  SSH_BOOT_PROBE_TIMEOUT_MS: 10_000,
}))

vi.mock('#/system/ssh/diagnostics.ts', () => ({
  makeUnresolvedTargetDiagnostic: mocks.makeUnresolvedTargetDiagnostic,
  testRemoteWorkspace: mocks.testRemoteWorkspace,
}))

vi.mock('#/system/ssh/config.ts', () => ({
  listSshConfigHosts: mocks.listSshConfigHosts,
  resolveRemoteTarget: mocks.resolveRemoteTarget,
  resolveTrackedRemoteTarget: mocks.resolveTrackedRemoteTarget,
}))

describe('server remote target resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('recomputes display name after expanding a home-relative remote path', async () => {
    const temporaryTarget = normalizeRemoteTarget({
      alias: 'prod',
      host: 'example.test',
      user: 'alice',
      port: 22,
      remotePath: '/',
    })
    expect(temporaryTarget).not.toBeNull()
    mocks.resolveRemoteTarget.mockResolvedValue({ target: temporaryTarget })
    mocks.runRemoteCommand.mockResolvedValue({
      ok: true,
      stdout: '/home/alice\n',
      stderr: '',
      message: 'ok',
      timedOut: false,
    })

    const { resolveServerRemoteTarget } = await import('#/server/modules/remote-workspace.ts')
    const result = await resolveServerRemoteTarget({ alias: 'prod', remotePath: '~/service' })

    expect('target' in result).toBe(true)
    if (!('target' in result)) return
    expect(result.target).toMatchObject({
      id: 'goblin+ssh://prod/home/alice/service',
      alias: 'prod',
      host: 'example.test',
      user: 'alice',
      port: 22,
      remotePath: '/home/alice/service',
      displayName: 'prod:service',
    })
    expect(result.target.displayName).not.toBe('prod:/')
  })

  test('opens a readable SSH directory when Git is not available there', async () => {
    const target = normalizeRemoteTarget({
      alias: 'prod',
      host: 'example.test',
      user: 'alice',
      port: 22,
      remotePath: '/srv/workspace',
    })!
    const { resolveServerRemoteWorkspaceConnection } = await import('#/server/modules/remote-workspace.ts')

    await expect(
      resolveServerRemoteWorkspaceConnection({ workspaceId: target.id }, undefined, {
        resolveTarget: async () => ({ target }),
        probeRemote: async () => ({ ok: false, category: 'not-a-repo' }),
      }),
    ).resolves.toEqual({
      kind: 'ready',
      name: 'prod:workspace',
      gitAvailable: false,
      lifecycle: { kind: 'ready', target },
    })
  })

  test('rejects a local workspace at the remote connection boundary', async () => {
    const { resolveServerRemoteWorkspaceConnection } = await import('#/server/modules/remote-workspace.ts')

    await expect(
      resolveServerRemoteWorkspaceConnection({ workspaceId: workspaceIdForTest('goblin+file:///srv/workspace') }),
    ).rejects.toThrow('remote workspace connection requires an SSH workspace id')
  })

  test('keeps a readable directory ready when Git enrichment times out', async () => {
    const target = normalizeRemoteTarget({
      alias: 'prod',
      host: 'example.test',
      user: 'alice',
      port: 22,
      remotePath: '/srv/workspace',
    })!
    const { resolveServerRemoteWorkspaceConnection } = await import('#/server/modules/remote-workspace.ts')
    const result = await resolveServerRemoteWorkspaceConnection({ workspaceId: target.id }, undefined, {
      resolveTarget: async () => ({ target }),
      probeRemote: async () => ({
        ok: false,
        category: 'timeout',
        message: 'timeout',
        stages: [
          { name: 'git', status: 'failed' },
          { name: 'path', status: 'passed' },
          { name: 'repo', status: 'failed' },
        ],
      }),
    })
    expect(result).toMatchObject({ kind: 'ready', gitAvailable: false, gitDiagnostic: 'timeout' })
  })

  test('keeps directory availability authoritative when Git also fails', async () => {
    const target = normalizeRemoteTarget({
      alias: 'prod',
      host: 'example.test',
      user: 'alice',
      port: 22,
      remotePath: '/missing',
    })!
    const { resolveServerRemoteWorkspaceConnection } = await import('#/server/modules/remote-workspace.ts')
    const result = await resolveServerRemoteWorkspaceConnection({ workspaceId: target.id }, undefined, {
      resolveTarget: async () => ({ target }),
      probeRemote: async () => ({
        ok: false,
        category: 'git-missing',
        stages: [
          { name: 'git', status: 'failed', category: 'git-missing' },
          { name: 'path', status: 'failed', category: 'path-missing' },
          { name: 'repo', status: 'failed', category: 'not-a-repo' },
        ],
      }),
    })
    expect(result).toMatchObject({ kind: 'failed', lifecycle: { reason: 'path-missing' } })
  })

  test('does not enable Git found only in a parent of the selected directory', async () => {
    const target = normalizeRemoteTarget({
      alias: 'prod',
      host: 'example.test',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo/child',
    })!
    const { resolveServerRemoteWorkspaceConnection } = await import('#/server/modules/remote-workspace.ts')
    await expect(
      resolveServerRemoteWorkspaceConnection({ workspaceId: target.id }, undefined, {
        resolveTarget: async () => ({ target }),
        probeRemote: async () => ({ ok: true, gitAtWorkspaceRoot: false }),
      }),
    ).resolves.toMatchObject({ kind: 'ready', gitAvailable: false })
  })
})
