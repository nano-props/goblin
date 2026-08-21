import { isRepoReadInvalidationEvent, type RepoReadInvalidationEvent } from '#/shared/repo-read-invalidation.ts'
import {
  isWorkspaceRuntimeInvalidationEvent,
  type WorkspaceRuntimeInvalidationEvent,
} from '#/shared/workspace-runtime-invalidation.ts'
import {
  isWorkspaceFilesystemInvalidationEvent,
  type WorkspaceFilesystemInvalidationEvent,
} from '#/shared/workspace-filesystem-invalidation.ts'
import { isStringIn } from '#/shared/string-literals.ts'

export const SETTINGS_INVALIDATION_SCOPES = ['settings-snapshot', 'external-apps', 'i18n', 'theme'] as const

export type SettingsInvalidationScope = (typeof SETTINGS_INVALIDATION_SCOPES)[number]

export interface SettingsInvalidationEvent {
  type: 'settings-invalidated'
  scopes: SettingsInvalidationScope[]
}

export type ServerInvalidationEvent =
  | RepoReadInvalidationEvent
  | WorkspaceRuntimeInvalidationEvent
  | WorkspaceFilesystemInvalidationEvent
  | SettingsInvalidationEvent

export function isSettingsInvalidationScope(value: unknown): value is SettingsInvalidationScope {
  return isStringIn(SETTINGS_INVALIDATION_SCOPES, value)
}

export function isSettingsInvalidationEvent(value: unknown): value is SettingsInvalidationEvent {
  if (!value || typeof value !== 'object') return false
  const type = Reflect.get(value, 'type')
  const scopes = Reflect.get(value, 'scopes')
  return (
    type === 'settings-invalidated' &&
    Array.isArray(scopes) &&
    scopes.every((scope) => isSettingsInvalidationScope(scope))
  )
}

export function isServerInvalidationEvent(value: unknown): value is ServerInvalidationEvent {
  return (
    isRepoReadInvalidationEvent(value) ||
    isWorkspaceRuntimeInvalidationEvent(value) ||
    isWorkspaceFilesystemInvalidationEvent(value) ||
    isSettingsInvalidationEvent(value)
  )
}

export function settingsInvalidationScopesForPrefsPatch(patch: Record<string, unknown>): SettingsInvalidationScope[] {
  const scopes = new Set<SettingsInvalidationScope>(['settings-snapshot'])
  if ('lang' in patch) scopes.add('i18n')
  if ('theme' in patch || 'colorTheme' in patch) scopes.add('theme')
  return [...scopes]
}
