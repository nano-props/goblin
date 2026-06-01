import type { RemoteDiagnosticsResult, RemoteRepoTarget } from '#/shared/remote-repo.ts'

const SSH_SETTINGS_REASONS = new Set([
  'error.ssh-config-changed',
  'repo-tabs.open-remote-home-unavailable',
  'auth-failed',
  'host-key',
  'config-changed',
])

const REMOTE_DIAGNOSTIC_REASONS = new Set([
  'auth-failed',
  'host-key',
  'unreachable',
  'shell-failed',
  'git-missing',
  'path-missing',
  'not-a-repo',
  'timeout',
  'cancelled',
  'config-changed',
  'unknown',
])

function reasonTranslationKey(reason: string): string {
  return REMOTE_DIAGNOSTIC_REASONS.has(reason)
    ? `repo-tabs.open-remote-diagnostics-category-${reason}`
    : reason
}

export function formatTranslatableReason(
  t: (key: string) => string,
  reason: string,
): string {
  const key = reasonTranslationKey(reason)
  const translated = t(key)
  return translated === key ? reason : translated
}

export function unavailableBodyKey(isRemote: boolean, reason: string): string {
  if (!isRemote) return 'repo-unavailable.body'
  if (reason === 'error.ssh-config-changed') return 'repo-unavailable.remote-config-changed'
  if (reason === 'repo-tabs.open-remote-home-unavailable') return 'repo-unavailable.remote-home-unavailable'
  if (reason === 'path-missing') return 'repo-unavailable.remote-path-missing'
  if (reason === 'not-a-repo') return 'repo-unavailable.remote-not-a-repo'
  if (REMOTE_DIAGNOSTIC_REASONS.has(reason)) return 'repo-unavailable.remote-connect-failed'
  return 'repo-unavailable.remote-body'
}

export function shouldOfferSshSettings(reasonOrCategory: string | null | undefined): boolean {
  return !!reasonOrCategory && SSH_SETTINGS_REASONS.has(reasonOrCategory)
}

export function failedDiagnosticsCategory(diagnostics: RemoteDiagnosticsResult | null): string | null {
  if (!diagnostics || diagnostics.ok) return null
  return diagnostics.category ?? diagnostics.stages.find((stage) => stage.status === 'failed')?.category ?? diagnostics.message ?? null
}

export function remoteSshCommand(target: Pick<RemoteRepoTarget, 'alias'>): string {
  return `ssh ${target.alias}`
}
