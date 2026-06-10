import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveRemoteTarget: vi.fn(),
  getServerSettingsPrefs: vi.fn(),
  openRemoteInPreferredEditor: vi.fn(),
  openRemoteInPreferredTerminal: vi.fn(),
}))

vi.mock('#/system/ssh/config.ts', () => ({
  listSshConfigHosts: vi.fn(),
  resolveRemoteTarget: mocks.resolveRemoteTarget,
  resolveTrackedRemoteTarget: vi.fn(),
}))
vi.mock('#/system/ssh/commands.ts', () => ({ runRemoteCommand: vi.fn() }))
vi.mock('#/system/ssh/diagnostics.ts', () => ({ testRemoteRepository: vi.fn() }))
vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerSettingsPrefs: mocks.getServerSettingsPrefs,
}))
vi.mock('#/system/editors.ts', () => ({
  openRemoteInPreferredEditor: mocks.openRemoteInPreferredEditor,
}))
vi.mock('#/system/terminals.ts', () => ({
  openRemoteInPreferredTerminal: mocks.openRemoteInPreferredTerminal,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getServerSettingsPrefs.mockResolvedValue({
    theme: 'auto',
    colorTheme: 'macos',
    lang: 'auto',
    fetchIntervalSec: 120,
    terminalNotificationsEnabled: false,
    shortcutsDisabled: false,
    globalShortcutDisabled: false,
    swapCloseShortcuts: false,
    toggleDetailOnActionBarBlankClick: false,
    globalShortcut: 'CommandOrControl+Shift+G',
    terminalApp: 'auto',
    editorApp: 'vscode',
  })
  mocks.resolveRemoteTarget.mockResolvedValue({
    target: {
      id: 'ssh-config://prod/srv/repo',
      alias: 'prod',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
    },
  })
  mocks.openRemoteInPreferredEditor.mockResolvedValue({ ok: true, message: '/srv/repo-feature' })
  mocks.openRemoteInPreferredTerminal.mockResolvedValue({ ok: true, message: '/srv/repo-feature' })
})

describe('openServerRemoteEditor', () => {
  test('resolves ssh config and opens the configured remote editor', async () => {
    const { openServerRemoteEditor } = await import('#/server/modules/remote.ts')

    await expect(
      openServerRemoteEditor({ repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' }),
    ).resolves.toEqual({ ok: true, message: '/srv/repo-feature' })

    expect(mocks.resolveRemoteTarget).toHaveBeenCalledWith({ alias: 'prod', remotePath: '/srv/repo' }, undefined)
    expect(mocks.openRemoteInPreferredEditor).toHaveBeenCalledWith('prod', '/srv/repo-feature', 'vscode')
  })

  test('rejects invalid repo ids and remote worktree paths', async () => {
    const { openServerRemoteEditor } = await import('#/server/modules/remote.ts')

    await expect(openServerRemoteEditor({ repoId: '/tmp/local', worktreePath: '/srv/repo' })).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(
      openServerRemoteEditor({ repoId: 'ssh-config://prod/srv/repo', worktreePath: 'relative/repo' }),
    ).resolves.toEqual({ ok: false, message: 'error.invalid-arguments' })

    expect(mocks.openRemoteInPreferredEditor).not.toHaveBeenCalled()
  })

  test('returns ssh-config-changed when the saved remote no longer resolves', async () => {
    mocks.resolveRemoteTarget.mockRejectedValue(new Error('error.ssh-config-changed'))
    const { openServerRemoteEditor } = await import('#/server/modules/remote.ts')

    await expect(
      openServerRemoteEditor({ repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' }),
    ).resolves.toEqual({ ok: false, message: 'error.ssh-config-changed' })
  })
})

describe('openServerRemoteTerminal', () => {
  test('resolves ssh config and opens the configured remote terminal', async () => {
    const { openServerRemoteTerminal } = await import('#/server/modules/remote.ts')

    await expect(
      openServerRemoteTerminal({ repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' }),
    ).resolves.toEqual({ ok: true, message: '/srv/repo-feature' })

    expect(mocks.resolveRemoteTarget).toHaveBeenCalledWith({ alias: 'prod', remotePath: '/srv/repo' }, undefined)
    expect(mocks.openRemoteInPreferredTerminal).toHaveBeenCalledWith('prod', '/srv/repo-feature', 'auto')
  })

  test('rejects invalid repo ids and remote worktree paths', async () => {
    const { openServerRemoteTerminal } = await import('#/server/modules/remote.ts')

    await expect(openServerRemoteTerminal({ repoId: '/tmp/local', worktreePath: '/srv/repo' })).resolves.toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
    await expect(
      openServerRemoteTerminal({ repoId: 'ssh-config://prod/srv/repo', worktreePath: 'relative/repo' }),
    ).resolves.toEqual({ ok: false, message: 'error.invalid-arguments' })

    expect(mocks.openRemoteInPreferredTerminal).not.toHaveBeenCalled()
  })

  test('returns ssh-config-changed when the saved remote no longer resolves', async () => {
    mocks.resolveRemoteTarget.mockRejectedValue(new Error('error.ssh-config-changed'))
    const { openServerRemoteTerminal } = await import('#/server/modules/remote.ts')

    await expect(
      openServerRemoteTerminal({ repoId: 'ssh-config://prod/srv/repo', worktreePath: '/srv/repo-feature' }),
    ).resolves.toEqual({ ok: false, message: 'error.ssh-config-changed' })
  })
})
