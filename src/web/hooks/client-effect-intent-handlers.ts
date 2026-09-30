import { runShowWorkspacePaneTabCommand, runTerminalPrimaryActionCommand } from '#/web/commands/workspace-commands.ts'
import { createTerminalBellIntentPlan, createWorkspaceIntentPlan } from '#/web/hooks/client-effect-intent-plans.ts'
import type { AppNavigationActions } from '#/web/app/navigation/actions.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import type { ClientEffectIntent, RepoViewClientIntent } from '#/shared/client-effect-intents.ts'
import { getRepoSnapshotQueryData } from '#/web/repos/query-cache.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { commitWorkspacePaneTerminalDestination } from '#/web/workspace-pane/workspace-pane-terminal-destination-navigation.ts'
import { surfaceWorkspacePaneTerminalDestinationOutcome } from '#/web/workspace-pane/workspace-pane-terminal-destination-feedback.ts'

interface TerminalBellIntentDeps {
  navigation: AppNavigationActions
  closeAllOverlays: () => void
  terminalBellWorkspace: WorkspaceState | null
}

interface WorkspaceClientIntentDeps {
  navigation: AppNavigationActions
  currentWorkspace: WorkspaceState | null
  currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null
  overlayBlocked: boolean
  workspaceShortcutSuppressed: boolean
  t: (key: string) => string
}

export function handleTerminalBellClickIntent(
  event: Extract<ClientEffectIntent, { type: 'terminal-bell-click' }>,
  deps: TerminalBellIntentDeps,
): void {
  const workspace = deps.terminalBellWorkspace ?? undefined
  const snapshot = workspace ? getRepoSnapshotQueryData(workspace.id, workspace.workspaceRuntimeId) : undefined
  const repositoryFacts = snapshot ? { snapshot } : null
  const plan = createTerminalBellIntentPlan(workspace, repositoryFacts, event)
  if (plan.kind === 'noop') return
  if (plan.kind === 'unavailable') {
    surfaceWorkspacePaneTerminalDestinationOutcome({ kind: 'target-missing' })
    return
  }
  deps.closeAllOverlays()
  void commitWorkspacePaneTerminalDestination({
    location: plan.location,
    base: event.session,
    terminalSessionId: event.terminalSessionId,
    navigation: deps.navigation,
  }).then(surfaceWorkspacePaneTerminalDestinationOutcome, (error) =>
    surfaceWorkspacePaneTerminalDestinationOutcome(null, error),
  )
}

export async function handleWorkspaceClientIntent(
  event: RepoViewClientIntent,
  deps: WorkspaceClientIntentDeps,
): Promise<boolean> {
  const plan = createWorkspaceIntentPlan(event, {
    overlayBlocked: deps.overlayBlocked,
    workspaceShortcutSuppressed: deps.workspaceShortcutSuppressed,
    currentWorkspaceId: deps.currentWorkspace?.id ?? null,
    currentWorkspacePaneCommandTarget: deps.currentWorkspacePaneCommandTarget,
  })
  switch (plan.kind) {
    case 'noop':
      return true
    case 'show-workspace-pane-tab':
      if (plan.tab === 'terminal') {
        return runTerminalPrimaryActionCommand({
          workspaceId: plan.workspaceId,
          target: plan.target,
          navigation: deps.navigation,
          t: deps.t,
        })
      }
      return runShowWorkspacePaneTabCommand({
        workspaceId: plan.workspaceId,
        target: plan.target,
        tab: plan.tab,
        navigation: deps.navigation,
      })
  }
}
