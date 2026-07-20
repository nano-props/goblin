import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const execaMock = vi.hoisted(() => vi.fn())
let tmpHome: string

vi.mock('execa', () => ({
  execa: execaMock,
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return {
    ...actual,
    homedir: () => tmpHome,
    userInfo: () => ({ username: 'tester' }),
  }
})

describe('ssh config resolution', () => {
  beforeEach(() => {
    vi.resetModules()
    execaMock.mockReset()
    tmpHome = mkdtempSync(path.join(os.tmpdir(), 'goblin-ssh-config-test-'))
    process.env.HOME = tmpHome
    mkdirSync(path.join(tmpHome, '.ssh'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
  })

  test.each(['-F', '.', '..', 'bad alias', '服务器', ' prod '])(
    'rejects invalid profile %j before starting ssh',
    async (alias) => {
      const mod = await import('#/system/ssh/config.ts')
      await expect(mod.resolveRemoteTarget({ alias, remotePath: '/' })).rejects.toThrow('Invalid SSH config host alias')
      expect(execaMock).not.toHaveBeenCalled()
    },
  )

  test('lists concrete hosts and computes inherited values without surfacing wildcard aliases', async () => {
    const mod = await import('#/system/ssh/config.ts')

    expect(
      mod.parseSshConfig(
        [
          'Host *',
          '  User ignored',
          'Host prod github-work',
          '  HostName example.com',
          '  User ubuntu',
          '  Port 2222',
        ].join('\n'),
      ),
    ).toEqual({
      hasInclude: false,
      hosts: [
        { alias: 'prod', hostName: 'example.com', user: 'ignored', port: 2222 },
        { alias: 'github-work', hostName: 'example.com', user: 'ignored', port: 2222 },
      ],
    })
  })

  test('marks configs with Include directives so the UI can fall back to manual alias input', async () => {
    const mod = await import('#/system/ssh/config.ts')

    expect(mod.parseSshConfig(['Include ~/.ssh/conf.d/*', 'Host prod', '  HostName example.com'].join('\n'))).toEqual({
      hasInclude: true,
      hosts: [{ alias: 'prod', hostName: 'example.com' }],
    })
  })

  test('resolves targets only for aliases present in ~/.ssh/config', async () => {
    const configPath = path.join(tmpHome, '.ssh', 'config')
    writeFileSync(configPath, 'Host prod\n  HostName example.com\n  User ubuntu\n  Port 2222\n')
    execaMock.mockResolvedValue({ stdout: 'hostname example.com\nuser ubuntu\nport 2222\n' })
    const mod = await import('#/system/ssh/config.ts')
    await expect(mod.listSshConfigHosts(configPath)).resolves.toEqual({
      hasInclude: false,
      hosts: [{ alias: 'prod', hostName: 'example.com', user: 'ubuntu', port: 2222 }],
    })

    await expect(mod.resolveRemoteTarget({ alias: 'prod', remotePath: '/srv/repo' })).resolves.toMatchObject({
      target: {
        alias: 'prod',
        host: 'example.com',
        user: 'ubuntu',
        port: 2222,
        remotePath: '/srv/repo',
      },
    })
    await expect(mod.resolveRemoteTarget({ alias: 'missing', remotePath: '/srv/repo' })).rejects.toThrow(
      'error.ssh-config-changed',
    )
  })

  test('allows manually entered aliases when the config contains Include directives', async () => {
    writeFileSync(path.join(tmpHome, '.ssh', 'config'), 'Include ~/.ssh/conf.d/*\n')
    execaMock.mockResolvedValue({ stdout: 'hostname included.example.com\nuser ubuntu\nport 2222\n' })
    const mod = await import('#/system/ssh/config.ts')

    await expect(mod.resolveRemoteTarget({ alias: 'prod', remotePath: '/srv/repo' })).resolves.toMatchObject({
      target: {
        alias: 'prod',
        host: 'included.example.com',
        user: 'ubuntu',
        port: 2222,
        remotePath: '/srv/repo',
      },
    })
  })

  test('uses the current ssh config as the source of truth for tracked targets', async () => {
    writeFileSync(
      path.join(tmpHome, '.ssh', 'config'),
      'Host prod\n  HostName changed.example.com\n  User ubuntu\n  Port 2222\n',
    )
    execaMock.mockResolvedValue({ stdout: 'hostname changed.example.com\nuser ubuntu\nport 2222\n' })
    const mod = await import('#/system/ssh/config.ts')

    await expect(
      mod.resolveTrackedRemoteTarget({
        id: workspaceIdForTest('goblin+ssh://prod/srv/repo'),
        alias: 'prod',
        remotePath: '/srv/repo',
        displayName: 'prod:/srv/repo',
      }),
    ).resolves.toMatchObject({
      target: {
        id: workspaceIdForTest('goblin+ssh://prod/srv/repo'),
        alias: 'prod',
        host: 'changed.example.com',
        user: 'ubuntu',
        port: 2222,
        remotePath: '/srv/repo',
      },
    })
  })

  test('treats a deleted tracked alias as config drift', async () => {
    writeFileSync(path.join(tmpHome, '.ssh', 'config'), 'Host other\n  HostName other.example.com\n')
    const mod = await import('#/system/ssh/config.ts')

    await expect(
      mod.resolveTrackedRemoteTarget({
        id: workspaceIdForTest('goblin+ssh://prod/srv/repo'),
        alias: 'prod',
        remotePath: '/srv/repo',
        displayName: 'prod:/srv/repo',
      }),
    ).rejects.toThrow('error.ssh-config-changed')
  })
})
