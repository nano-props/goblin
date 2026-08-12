import {
  defaultWorkspacePaneTabEntries,
  workspacePaneRuntimeTabEntry,
  type WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneDurableLayout, WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  runtimeWorkspacePaneTargetKey,
  workspacePaneTabsTargetFromRestorable,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { RestorableWorkspacePaneTarget, RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import { canonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  projectRuntimePlacements,
  type WorkspacePaneEpochScope,
  type WorkspacePaneEpochOverlay,
} from '#/server/workspace-pane/workspace-pane-epoch-overlay.ts'
import type { WorkspacePaneRuntimeTabsProviderSnapshot } from '#/server/workspace-pane/workspace-pane-runtime-tabs-projection.ts'

export interface WorkspacePaneTargetProjection {
  target: RuntimeWorkspacePaneTarget
  nativeWorktreePath: string | null
  canonicalBranch: string | null
}

interface WorkspacePaneRuntimeScope {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}

export function projectCanonicalEntries(
  scope: WorkspacePaneEpochScope,
  layout: WorkspacePaneDurableLayout,
  overlay: WorkspacePaneEpochOverlay,
  validatedTargets: ReadonlyMap<string, WorkspacePaneTargetProjection>,
  providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
): WorkspacePaneTabsSnapshot['entries'] {
  const liveTargets = providerTargets(scope, validatedTargets, providers)
  const validatedLayout = {
    entries: layout.entries.filter((entry) => validatedTargets.has(durableTargetKey(scope, entry.target))),
  }
  const targets = new Map<string, WorkspacePaneTargetProjection>()
  for (const entry of validatedLayout.entries) {
    const key = durableTargetKey(scope, entry.target)
    const projection = validatedTargets.get(key)
    if (!projection) throw new Error('error.workspace-tabs-target-invalid')
    targets.set(key, projection)
  }
  for (const [key, target] of liveTargets) targets.set(key, target)
  return Array.from(targets.values()).map((projection) => {
    const tabs = canonicalTabsForTarget({ ...scope, ...projection }, validatedLayout, overlay, providers)
    return { target: projection.target, tabs }
  })
}

export function targetMap(
  targets: readonly WorkspacePaneTargetProjection[],
): Map<string, WorkspacePaneTargetProjection> {
  return new Map(
    targets
      .map(
        (projection) => [targetProjectionKey(projection), { ...projection, target: { ...projection.target } }] as const,
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

export function canonicalTabsForTarget(
  input: WorkspacePaneEpochScope & WorkspacePaneTargetProjection,
  layout: WorkspacePaneDurableLayout,
  overlay: WorkspacePaneEpochOverlay,
  providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
): WorkspacePaneTabEntry[] {
  const durable = layout.entries.find((entry) => durableTargetKey(input, entry.target) === targetProjectionKey(input))
  const staticTabs = durable?.tabs ?? defaultWorkspacePaneTabEntries()
  const liveRuntimeTabs = providers.flatMap((provider) =>
    provider.liveSessions
      .filter((session) => input.nativeWorktreePath !== null && session.worktreePath === input.nativeWorktreePath)
      .map((session) => workspacePaneRuntimeTabEntry(provider.type, session.sessionId)),
  )
  return projectRuntimePlacements({
    staticTabs,
    hints: overlay.placementHints(input),
    liveRuntimeTabs,
  })
}

export function runtimeTargetKey(target: RuntimeWorkspacePaneTarget): string {
  const key = runtimeWorkspacePaneTargetKey(target)
  if (!key) throw new Error('error.workspace-tabs-target-invalid')
  return key
}

export function targetProjectionKey(projection: WorkspacePaneTargetProjection): string {
  return runtimeTargetKey(projection.target)
}

function providerTargets(
  scope: WorkspacePaneEpochScope,
  validatedTargets: ReadonlyMap<string, WorkspacePaneTargetProjection>,
  providers: readonly WorkspacePaneRuntimeTabsProviderSnapshot[],
): Map<string, WorkspacePaneTargetProjection> {
  const targets = new Map<string, WorkspacePaneTargetProjection>()
  for (const provider of providers) {
    for (const session of provider.liveSessions) {
      if (
        session.target.workspaceId !== scope.workspaceId ||
        session.target.workspaceRuntimeId !== scope.workspaceRuntimeId
      ) {
        throw new Error('error.workspace-tabs-target-invalid')
      }
      const key = runtimeTargetKey(session.target)
      const validated = validatedTargets.get(key)
      if (validated && validated.nativeWorktreePath !== session.worktreePath) {
        throw new Error('error.workspace-tabs-target-invalid')
      }
      targets.set(
        key,
        validated ?? {
          target: session.target,
          nativeWorktreePath: session.worktreePath,
          canonicalBranch: session.branch,
        },
      )
    }
  }
  return targets
}

function durableTargetKey(scope: WorkspacePaneRuntimeScope, target: RestorableWorkspacePaneTarget): string {
  const workspaceId = canonicalWorkspaceLocator(scope.workspaceId)
  if (!workspaceId) throw new Error('error.workspace-tabs-target-invalid')
  const runtime = workspacePaneTabsTargetFromRestorable(workspaceId, target)
  if (!runtime) throw new Error('error.workspace-tabs-target-invalid')
  const bound =
    target.kind === 'workspace-root'
      ? { kind: 'workspace-root' as const, workspaceId, workspaceRuntimeId: scope.workspaceRuntimeId }
      : target.kind === 'git-branch'
        ? { ...target, workspaceId, workspaceRuntimeId: scope.workspaceRuntimeId }
        : { ...target, workspaceId, workspaceRuntimeId: scope.workspaceRuntimeId }
  return runtimeTargetKey(bound)
}
