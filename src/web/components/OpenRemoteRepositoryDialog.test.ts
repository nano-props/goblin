import { describe, expect, test } from 'vitest'
import {
  buildRemoteConnectionInput,
  canSubmitRemoteRepository,
  formatRemoteDialogError,
  formatRemotePathPreview,
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
    expect(remotePathError('repo').errorKey).toBe('repo-tabs.open-remote-path-absolute')
    expect(remotePathError('~/repo').errorKey).toBeNull()
  })

  test('shows a clearer preview once a home-relative path has been expanded', () => {
    const t = (key: string, params?: Record<string, string>) => {
      if (key === 'repo-tabs.open-remote-path-preview-expanded') return `${params?.input} -> ${params?.expanded}`
      if (key === 'repo-tabs.open-remote-path-preview') return String(params?.path)
      return key
    }
    expect(
      formatRemotePathPreview(t, {
        alias: 'prod',
        remotePath: '~/repo',
        target: {
          id: 'ssh-config://prod/home/alice/repo',
          alias: 'prod',
          host: 'example.com',
          user: 'alice',
          port: 22,
          remotePath: '/home/alice/repo',
          displayName: 'prod:repo',
        },
      }),
    ).toBe('prod:~/repo -> prod:/home/alice/repo')
  })

  test('keeps raw dialog errors as-is instead of leaking a missing i18n lookup', () => {
    const t = (key: string) => key
    expect(formatRemoteDialogError(t, 'Permission denied')).toBe('Permission denied')
    expect(formatRemoteDialogError(t, 'error.ssh-config-changed')).toBe('error.ssh-config-changed')
  })
})
