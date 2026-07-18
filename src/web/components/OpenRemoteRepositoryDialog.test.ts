import { describe, expect, test } from 'vitest'
import {
  buildRemoteConnectionInput,
  canSubmitRemoteRepository,
  formatRemoteDialogError,
  remoteDiagnosticsAllowWorkspaceOpen,
  remotePathError,
} from '#/web/components/OpenRemoteRepositoryDialog.tsx'

describe('OpenRemoteRepositoryDialog helpers', () => {
  test('builds config-only remote inputs', () => {
    expect(buildRemoteConnectionInput('prod', '/srv/repo')).toEqual({ alias: 'prod', remotePath: '/srv/repo' })
    expect(buildRemoteConnectionInput('prod', '~/repo')).toEqual({ alias: 'prod', remotePath: '~/repo' })
    expect(buildRemoteConnectionInput('', '/srv/repo')).toBeNull()
  })

  test('allows manual aliases as long as alias and path are valid', () => {
    for (const alias of ['-F', '.', '..', 'bad alias', '服务器']) {
      expect(canSubmitRemoteRepository({ alias, remotePath: '/srv/repo', pending: false })).toBe(false)
      expect(buildRemoteConnectionInput(alias, '/srv/repo')).toBeNull()
    }
    expect(
      canSubmitRemoteRepository({
        alias: 'prod',
        remotePath: '/srv/repo',
        pending: false,
      }),
    ).toBe(true)
  })

  test('rejects non-absolute remote paths', () => {
    expect(remotePathError('repo').errorKey).toBe('workspace-picker.open-remote-path-absolute')
    expect(remotePathError('~/repo').errorKey).toBeNull()
  })

  test('uses the passed path stage as the workspace-open admission boundary', () => {
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

  test('keeps raw dialog errors as-is instead of leaking a missing i18n lookup', () => {
    const t = (key: string) => key
    expect(formatRemoteDialogError(t, 'Permission denied')).toBe('Permission denied')
    expect(formatRemoteDialogError(t, 'error.ssh-config-changed')).toBe('error.ssh-config-changed')
  })
})
