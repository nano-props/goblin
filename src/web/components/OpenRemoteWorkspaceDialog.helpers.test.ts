import { describe, expect, test } from 'vitest'
import {
  buildRemoteConnectionInput,
  canSubmitRemoteWorkspace,
  formatRemoteDialogError,
  remoteDiagnosticsAllowWorkspaceOpen,
  remotePathError,
} from '#/web/components/OpenRemoteWorkspaceDialog.tsx'

describe('OpenRemoteWorkspaceDialog helpers', () => {
  test('builds config-only remote inputs', async () => {
    expect(buildRemoteConnectionInput('prod', '/srv/repo')).toEqual({ alias: 'prod', remotePath: '/srv/repo' })
    expect(buildRemoteConnectionInput('prod', '~/repo')).toEqual({ alias: 'prod', remotePath: '~/repo' })
    expect(buildRemoteConnectionInput('', '/srv/repo')).toBeNull()
  })

  test('allows manual aliases as long as alias and path are valid', async () => {
    for (const alias of ['-F', '.', '..', 'bad alias', '服务器']) {
      expect(canSubmitRemoteWorkspace({ alias, remotePath: '/srv/repo', pending: false })).toBe(false)
      expect(buildRemoteConnectionInput(alias, '/srv/repo')).toBeNull()
    }
    expect(
      canSubmitRemoteWorkspace({
        alias: 'prod',
        remotePath: '/srv/repo',
        pending: false,
      }),
    ).toBe(true)
  })

  test('rejects non-absolute remote paths', async () => {
    expect(remotePathError('repo').errorKey).toBe('workspace-picker.open-remote-path-absolute')
    expect(remotePathError('~/repo').errorKey).toBeNull()
  })

  test('uses the passed path stage as the workspace-open admission boundary', async () => {
    expect(
      remoteDiagnosticsAllowWorkspaceOpen({
        stages: [
          { name: 'path', label: 'path', status: 'passed' },
          { name: 'git', label: 'git', status: 'failed', category: 'timeout' },
        ],
      }),
    ).toBe(true)
    expect(
      remoteDiagnosticsAllowWorkspaceOpen({
        stages: [
          { name: 'path', label: 'path', status: 'passed' },
          { name: 'repo', label: 'repo', status: 'failed', category: 'not-a-repo' },
        ],
      }),
    ).toBe(true)
    expect(
      remoteDiagnosticsAllowWorkspaceOpen({
        stages: [{ name: 'path', label: 'path', status: 'failed', category: 'path-missing' }],
      }),
    ).toBe(false)
    expect(
      remoteDiagnosticsAllowWorkspaceOpen({
        stages: [{ name: 'ssh', label: 'ssh', status: 'failed', category: 'auth-failed' }],
      }),
    ).toBe(false)
  })

  test('keeps raw dialog errors as-is instead of leaking a missing i18n lookup', async () => {
    const t = (key: string) => key
    expect(formatRemoteDialogError(t, 'Permission denied')).toBe('Permission denied')
    expect(formatRemoteDialogError(t, 'error.ssh-config-changed')).toBe('error.ssh-config-changed')
  })
})
