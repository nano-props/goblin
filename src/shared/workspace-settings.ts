import { workspaceLocatorForPath, type WorkspaceId } from '#/shared/workspace-locator.ts'
import type { RestorableWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import {
  parseRestorableWorkspacePaneTargetKey,
  restorableWorkspacePaneTargetKey,
  workspacePaneTabsTargetFromRestorable,
} from '#/shared/workspace-pane-tabs-target.ts'

export interface WorktreeBootstrapTrust {
  configHash: string
  trustedAt: string
}

/**
 * Per-filesystem-target record of the most recently chosen external app.
 * Keys use the canonical restorable target codec, never native paths.
 */
export interface WorkspaceExternalAppRecent {
  byTarget: Record<string, string>
}

export type WorkspaceExternalAppTarget = Extract<
  RestorableWorkspacePaneTarget,
  { kind: 'workspace-root' } | { kind: 'git-worktree' }
>

export interface WorkspaceSettingsEntry {
  workspaceId: WorkspaceId
  worktreeBootstrapTrust?: WorktreeBootstrapTrust
  workspaceExternalAppRecent?: WorkspaceExternalAppRecent
}

export const WORKTREE_BOOTSTRAP_CONFIG_HASH_RE = /^sha256:[a-f0-9]{64}$/

/**
 * The canonical list of valid `WorkspaceExternalAppItem.id` values
 * that the server is willing to persist as a "most recently chosen
 * external app" per worktree. Mirrors `WORKSPACE_EXTERNAL_APPS` in
 * `src/web/external-workspace-apps.tsx`; the canonical web list lives
 * in the web layer (where React components are wired up) and this
 * readonly tuple exists so the server can validate persisted ids
 * without pulling in the React side.
 *
 * `as const` preserves the literal union so callers can derive
 * `WorkspaceExternalAppId` below without a parallel enum.
 *
 * ============================================================================
 * Adding a new external app — see the checklist in
 * `src/system/editors.ts` (top of file) for the full 7-10 step
 * process. For WebStorm in particular, the id to add here would be
 * `'editor:webstorm'`. The compile-time guard in
 * `src/web/external-workspace-apps.tsx` will reject the build if
 * you add a new id to the web array without also adding it here
 * (and vice versa) — that's by design, leave the guard in place.
 * ============================================================================
 */
export const WORKSPACE_EXTERNAL_APP_IDS = ['terminal:ghostty', 'terminal:terminal', 'editor:vscode', 'finder'] as const

export type WorkspaceExternalAppId = (typeof WORKSPACE_EXTERNAL_APP_IDS)[number]

const KNOWN_APP_ID_SET: ReadonlySet<string> = new Set(WORKSPACE_EXTERNAL_APP_IDS)

export function isKnownWorkspaceExternalAppItemId(value: unknown): value is WorkspaceExternalAppId {
  return typeof value === 'string' && KNOWN_APP_ID_SET.has(value)
}

export function isWorktreeBootstrapConfigHash(value: unknown): value is string {
  return typeof value === 'string' && WORKTREE_BOOTSTRAP_CONFIG_HASH_RE.test(value)
}

export function workspaceSettingsEntry(
  workspaceSettings: readonly WorkspaceSettingsEntry[],
  workspaceId: WorkspaceId,
): WorkspaceSettingsEntry | undefined {
  return workspaceSettings.find((entry) => entry.workspaceId === workspaceId)
}

export function isWorkspaceWorktreeBootstrapConfigTrusted(
  workspaceSettings: readonly WorkspaceSettingsEntry[],
  workspaceId: WorkspaceId,
  configHash: string | null | undefined,
): boolean {
  if (!configHash) return false
  return workspaceSettingsEntry(workspaceSettings, workspaceId)?.worktreeBootstrapTrust?.configHash === configHash
}

/** Encode the persisted recent-app key through the canonical target codec. */
export function workspaceExternalAppRecentKey(target: WorkspaceExternalAppTarget): string {
  return restorableWorkspacePaneTargetKey(target)
}

export function parseWorkspaceExternalAppRecentKey(
  workspaceId: WorkspaceId,
  key: string,
): WorkspaceExternalAppTarget | null {
  const target = parseRestorableWorkspacePaneTargetKey(key)
  if (!target || target.kind === 'git-branch') return null
  if (restorableWorkspacePaneTargetKey(target) !== key) return null
  return workspacePaneTabsTargetFromRestorable(workspaceId, target) ? target : null
}

export function workspaceExternalAppTargetForWorktree(
  workspaceId: WorkspaceId,
  worktreePath: string,
): Extract<WorkspaceExternalAppTarget, { kind: 'git-worktree' }> | null {
  const root = workspaceLocatorForPath(workspaceId, worktreePath)
  return root ? { kind: 'git-worktree', root } : null
}

/**
 * Read the most recently chosen workspace-external-app id for a
 * Workspace filesystem target. Returns null when no matching entry exists.
 */
export function getRecentWorkspaceExternalAppId(
  workspaceSettings: readonly WorkspaceSettingsEntry[],
  workspaceId: WorkspaceId,
  target: WorkspaceExternalAppTarget | null,
): string | null {
  if (!target) return null
  const byTarget = workspaceSettingsEntry(workspaceSettings, workspaceId)?.workspaceExternalAppRecent?.byTarget
  if (!byTarget) return null
  return byTarget[workspaceExternalAppRecentKey(target)] ?? null
}
