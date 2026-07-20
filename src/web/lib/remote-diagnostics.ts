import {
  REMOTE_DIAGNOSTIC_CATEGORIES,
  type RemoteDiagnosticsResult,
  type RemoteWorkspaceTarget,
} from '#/shared/remote-workspace.ts'
const SSH_SETTINGS_REASONS = new Set([
  'error.ssh-config-changed',
  'workspace-picker.open-remote-home-unavailable',
  'auth-failed',
  'host-key',
  'config-changed',
])

const REMOTE_DIAGNOSTIC_REASONS = new Set<string>(REMOTE_DIAGNOSTIC_CATEGORIES)

function reasonTranslationKey(reason: string): string {
  return REMOTE_DIAGNOSTIC_REASONS.has(reason) ? `workspace-picker.open-remote-diagnostics-category-${reason}` : reason
}

export function formatTranslatableReason(t: (key: string) => string, reason: string): string {
  const key = reasonTranslationKey(reason)
  const translated = t(key)
  return translated === key ? reason : translated
}

export function unavailableBodyKey(isRemote: boolean, reason: string): string {
  if (!isRemote) return 'workspace-unavailable.body'
  if (reason === 'error.ssh-config-changed') return 'workspace-unavailable.remote-config-changed'
  if (reason === 'workspace-picker.open-remote-home-unavailable') return 'workspace-unavailable.remote-home-unavailable'
  if (reason === 'path-missing') return 'workspace-unavailable.remote-path-missing'
  if (REMOTE_DIAGNOSTIC_REASONS.has(reason)) return 'workspace-unavailable.remote-connect-failed'
  return 'workspace-unavailable.remote-body'
}

export function shouldOfferSshSettings(reasonOrCategory: string | null | undefined): boolean {
  return !!reasonOrCategory && SSH_SETTINGS_REASONS.has(reasonOrCategory)
}

export function failedDiagnosticsCategory(diagnostics: RemoteDiagnosticsResult | null): string | null {
  if (!diagnostics || diagnostics.ok) return null
  return (
    diagnostics.category ??
    diagnostics.stages.find((stage) => stage.status === 'failed')?.category ??
    diagnostics.message ??
    null
  )
}

export function remoteSshCommand(target: Pick<RemoteWorkspaceTarget, 'alias'>): string {
  return `ssh ${target.alias}`
}
