import { describe, expect, test } from 'vitest'
import {
  failedDiagnosticsCategory,
  formatTranslatableReason,
  remoteSshCommand,
  shouldOfferSshSettings,
  unavailableBodyKey,
} from '#/web/lib/remote-diagnostics.ts'

describe('remote diagnostics helpers', () => {
  test('formats translated and untranslated reasons safely', () => {
    const t = (key: string) => (key === 'error.ssh-config-changed' ? 'SSH config changed' : key)
    expect(formatTranslatableReason(t, 'error.ssh-config-changed')).toBe('SSH config changed')
    expect(formatTranslatableReason(t, 'Permission denied')).toBe('Permission denied')
  })

  test('maps remote unavailable reasons to more specific body copy', () => {
    expect(unavailableBodyKey(false, 'error.failed-read-repo')).toBe('repo-unavailable.body')
    expect(unavailableBodyKey(true, 'error.ssh-config-changed')).toBe('repo-unavailable.remote-config-changed')
    expect(unavailableBodyKey(true, 'repo-picker.open-remote-home-unavailable')).toBe(
      'repo-unavailable.remote-home-unavailable',
    )
    expect(unavailableBodyKey(true, 'path-missing')).toBe('repo-unavailable.remote-path-missing')
    expect(unavailableBodyKey(true, 'not-a-repo')).toBe('repo-unavailable.remote-not-a-repo')
    expect(unavailableBodyKey(true, 'unreachable')).toBe('repo-unavailable.remote-connect-failed')
  })

  test('offers SSH settings only for SSH configuration and auth failures', () => {
    expect(shouldOfferSshSettings('error.ssh-config-changed')).toBe(true)
    expect(shouldOfferSshSettings('auth-failed')).toBe(true)
    expect(shouldOfferSshSettings('host-key')).toBe(true)
    expect(shouldOfferSshSettings('unreachable')).toBe(false)
    expect(shouldOfferSshSettings(null)).toBe(false)
  })

  test('derives the failed diagnostics category and ssh command', () => {
    expect(
      failedDiagnosticsCategory({
        ok: false,
        category: 'auth-failed',
        message: 'auth-failed',
        details: 'Permission denied',
        target: {
          id: 'ssh-config://prod/srv/repo',
          alias: 'prod',
          host: 'example.com',
          user: 'alice',
          port: 22,
          remotePath: '/srv/repo',
          displayName: 'prod:repo',
        },
        stages: [
          { name: 'ssh', label: 'ssh', status: 'failed', category: 'auth-failed', details: 'Permission denied' },
        ],
      }),
    ).toBe('auth-failed')
    expect(remoteSshCommand({ alias: 'prod' })).toBe('ssh prod')
  })

  test('translates remote diagnostic categories through the diagnostics dictionary keys', () => {
    const t = (key: string) =>
      key === 'repo-picker.open-remote-diagnostics-category-auth-failed' ? 'Authentication failed' : key
    expect(formatTranslatableReason(t, 'auth-failed')).toBe('Authentication failed')
  })

  test('falls back to the original remote diagnostic reason when the translation key is missing', () => {
    const t = (key: string) => key
    expect(formatTranslatableReason(t, 'auth-failed')).toBe('auth-failed')
  })
})
