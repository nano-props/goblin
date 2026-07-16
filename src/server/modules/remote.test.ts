import { beforeEach, describe, expect, test, vi } from 'vitest'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'

const mocks = vi.hoisted(() => ({
  listSshConfigHosts: vi.fn(),
  makeUnresolvedTargetDiagnostic: vi.fn(),
  resolveRemoteTarget: vi.fn(),
  resolveTrackedRemoteTarget: vi.fn(),
  runRemoteCommand: vi.fn(),
  testRemoteRepo: vi.fn(),
}))

vi.mock('#/system/ssh/commands.ts', () => ({
  runRemoteCommand: mocks.runRemoteCommand,
  SSH_BOOT_PROBE_TIMEOUT_MS: 10_000,
}))

vi.mock('#/system/ssh/diagnostics.ts', () => ({
  makeUnresolvedTargetDiagnostic: mocks.makeUnresolvedTargetDiagnostic,
  testRemoteRepo: mocks.testRemoteRepo,
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

    const { resolveServerRemoteTarget } = await import('#/server/modules/remote.ts')
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
})
