import { isRepoQueryInvalidationEvent, type RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'

export const SETTINGS_INVALIDATION_SCOPES = ['settings-snapshot', 'external-apps', 'i18n', 'theme'] as const

export type SettingsInvalidationScope = (typeof SETTINGS_INVALIDATION_SCOPES)[number]

export interface SettingsInvalidationEvent {
  type: 'settings-invalidated'
  scopes: SettingsInvalidationScope[]
}

export type ServerInvalidationEvent = RepoQueryInvalidationEvent | SettingsInvalidationEvent

export function isSettingsInvalidationScope(value: unknown): value is SettingsInvalidationScope {
  return value === 'settings-snapshot' || value === 'external-apps' || value === 'i18n' || value === 'theme'
}

export function isSettingsInvalidationEvent(value: unknown): value is SettingsInvalidationEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<SettingsInvalidationEvent>
  return (
    event.type === 'settings-invalidated' &&
    Array.isArray(event.scopes) &&
    event.scopes.every((scope) => isSettingsInvalidationScope(scope))
  )
}

export function isServerInvalidationEvent(value: unknown): value is ServerInvalidationEvent {
  return isRepoQueryInvalidationEvent(value) || isSettingsInvalidationEvent(value)
}

export function settingsInvalidationScopesForPrefsPatch(patch: Record<string, unknown>): SettingsInvalidationScope[] {
  const scopes = new Set<SettingsInvalidationScope>(['settings-snapshot'])
  if ('lang' in patch) scopes.add('i18n')
  if ('theme' in patch || 'colorTheme' in patch) scopes.add('theme')
  if ('terminalApp' in patch || 'editorApp' in patch) scopes.add('external-apps')
  return [...scopes]
}
