import type { ClientEffectIntent, RepoViewClientIntent } from '#/shared/client-effect-intents.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { resolveWorkspacePaneTerminalDestination } from '#/web/workspace-pane/workspace-pane-terminal-destination-location.ts'
import type { FilesystemWorkspacePaneLocation } from '#/web/workspace-pane/workspace-pane-location.ts'

export type TerminalBellIntentPlan =
  { kind: 'noop' } | { kind: 'unavailable' } | { kind: 'show-terminal'; location: FilesystemWorkspacePaneLocation }

export type WorkspaceIntentPlan =
  | { kind: 'noop' }
  | {
      kind: 'show-workspace-pane-tab'
      workspaceId: WorkspaceId
      target: WorkspacePaneCommandTarget
      tab: WorkspacePaneTabType
    }

interface WorkspaceIntentPlanContext {
  overlayBlocked: boolean
  workspaceShortcutSuppressed: boolean
  currentWorkspaceId: WorkspaceId | null
  currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null
}

export function createTerminalBellIntentPlan(
  workspace: Pick<WorkspaceState, 'id' | 'workspaceRuntimeId' | 'capability'> | undefined,
  repositoryFacts: { snapshot: RepoSnapshot } | null,
  event: Extract<ClientEffectIntent, { type: 'terminal-bell-click' }>,
): TerminalBellIntentPlan {
  if (!workspace) return { kind: 'noop' }
  const resolution = resolveWorkspacePaneTerminalDestination({
    workspace,
    base: event.session,
    snapshot: repositoryFacts
      ? { kind: 'ready', worktrees: repositoryFacts.snapshot.worktrees }
      : { kind: 'unavailable' },
  })
  if (resolution.kind === 'ready') return { kind: 'show-terminal', location: resolution.location }
  return resolution.kind === 'pending' || (!repositoryFacts && resolution.kind === 'unavailable')
    ? { kind: 'unavailable' }
    : { kind: 'noop' }
}

export function createWorkspaceIntentPlan(
  event: RepoViewClientIntent,
  context: WorkspaceIntentPlanContext,
): WorkspaceIntentPlan {
  if (
    context.overlayBlocked ||
    context.workspaceShortcutSuppressed ||
    !context.currentWorkspaceId ||
    !context.currentWorkspacePaneCommandTarget
  )
    return { kind: 'noop' }
  return {
    kind: 'show-workspace-pane-tab',
    workspaceId: context.currentWorkspaceId,
    target: context.currentWorkspacePaneCommandTarget,
    tab: event.tab,
  }
}
