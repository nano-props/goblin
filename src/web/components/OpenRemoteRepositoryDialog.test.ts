import { describe, expect, test } from 'vitest'
import {
  buildRemoteConnectionInput,
  canSubmitRemoteRepository,
  formatRemoteDialogError,
  remotePathError,
} from '#/web/components/OpenRemoteRepositoryDialog.tsx'

describe('OpenRemoteRepositoryDialog helpers', () => {
  test('builds config-only remote inputs', () => {
    expect(buildRemoteConnectionInput('prod', '/srv/repo')).toEqual({ alias: 'prod', remotePath: '/srv/repo' })
    expect(buildRemoteConnectionInput('prod', '~/repo')).toEqual({ alias: 'prod', remotePath: '~/repo' })
    expect(buildRemoteConnectionInput('', '/srv/repo')).toBeNull()
  })

  test('allows manual aliases as long as alias and path are valid', () => {
    expect(
      canSubmitRemoteRepository({
        alias: 'prod',
        remotePath: '/srv/repo',
        pending: false,
      }),
    ).toBe(true)
    expect(
      canSubmitRemoteRepository({
        alias: 'prod',
        remotePath: '/srv/repo',
        pending: false,
      }),
    ).toBe(true)
  })

  test('rejects non-absolute remote paths', () => {
    expect(remotePathError('repo').errorKey).toBe('repo-picker.open-remote-path-absolute')
    expect(remotePathError('~/repo').errorKey).toBeNull()
  })

  test('keeps raw dialog errors as-is instead of leaking a missing i18n lookup', () => {
    const t = (key: string) => key
    expect(formatRemoteDialogError(t, 'Permission denied')).toBe('Permission denied')
    expect(formatRemoteDialogError(t, 'error.ssh-config-changed')).toBe('error.ssh-config-changed')
  })
})
