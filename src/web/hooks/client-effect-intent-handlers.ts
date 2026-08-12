import { toast } from 'vue-sonner'
import { runWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import { presentWorkspaceRefreshOutcome } from '#/web/workspace-refresh-feedback.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import { themeStore } from '#/web/stores/theme.ts'
import { i18nStore } from '#/web/stores/i18n.ts'
import { clearRecentWorkspaceHistory } from '#/web/settings-actions.ts'
import { openWorkspaceFromDialog } from '#/web/lib/open-workspace-dialog.ts'
import {
  reportCloseWorkspaceFailure,
  reportOpenWorkspacePostOpenError,
  reportOpenWorkspacePostOpenEffects,
  reportOpenWorkspaceUncertainty,
} from '#/web/lib/open-workspace-result-feedback.ts'
import { consumeExternalOpenPaths } from '#/web/app-shell-client.ts'
import { openWorkspacePaths } from '#/web/lib/open-workspace-paths.ts'
import { externalOpenLog } from '#/web/logger.ts'
import {
  runCloseCurrentWorkspacePaneTabCommand,
  runNewTerminalTabCommand,
  runShowWorkspacePaneTabCommand,
  runTerminalPrimaryActionCommand,
} from '#/web/commands/workspace-commands.ts'
import {
  createAppLevelIntentPlan,
  createExternalOpenDrainKickPlan,
  createTerminalBellIntentPlan,
  createWorkspaceIntentPlan,
  type ClientAppIntent,
  type ClientWorkspaceIntent,
} from '#/web/hooks/client-effect-intent-plans.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import type { OpenWorkspaceResult, WorkspaceState } from '#/web/stores/workspaces/types.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { getRepoOperationsQueryData, getRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import { projectBranchActionOperation } from '#/web/hooks/branch-action-state.ts'
import {
  workspacePaneCommandCoordinates,
  type WorkspacePaneCommandTarget,
} from '#/web/workspace-pane/workspace-pane-command-target.ts'
import { commitWorkspacePaneTerminalDestination } from '#/web/workspace-pane/workspace-pane-terminal-destination-navigation.ts'
import { surfaceWorkspacePaneTerminalDestinationOutcome } from '#/web/workspace-pane/workspace-pane-terminal-destination-feedback.ts'
import { appNavigationIsCurrent, beginAppNavigation } from '#/web/app-navigation-lifecycle.ts'

interface TerminalBellIntentDeps {
  navigation: AppNavigationActions
  closeAllOverlays: () => void
  terminalBellWorkspace: WorkspaceState | null
}

interface AppClientIntentDeps {
  navigation: AppNavigationActions
  openWorkspacePathDialog: () => void
  openCloneRepo: () => void
  openRemoteWorkspace: () => void
  overlayBlocked: boolean
  openWorkspaceMembership: (input: string | WorkspaceSessionEntry) => Promise<OpenWorkspaceResult>
  resetLayout: () => void
  t: (key: string) => string
}

interface WorkspaceClientIntentDeps {
  navigation: AppNavigationActions
  currentWorkspace: WorkspaceState | null
  currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null
  openCreateWorktree: () => void
  overlayBlocked: boolean
  workspaceShortcutSuppressed: boolean
  terminalFocused: boolean
  toggleZenMode: () => void
  t: (key: string) => string
}

interface ExternalOpenIntentDrainerDeps {
  openWorkspaceMembership: (path: string) => Promise<OpenWorkspaceResult>
  activateWorkspace: (workspaceId: WorkspaceId) => void
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
    base: event.session,
    terminalSessionId: event.terminalSessionId,
    navigation: deps.navigation,
  }).then(surfaceWorkspacePaneTerminalDestinationOutcome, (error) =>
    surfaceWorkspacePaneTerminalDestinationOutcome(null, error),
  )
}

export async function handleAppLevelClientIntent(event: ClientAppIntent, deps: AppClientIntentDeps): Promise<void> {
  // App-level intents are allowed even when no workspace is visible.
  const plan = createAppLevelIntentPlan(event, {
    overlayBlocked: deps.overlayBlocked,
  })
  switch (plan.kind) {
    case 'noop':
      return
    case 'open-settings':
      deps.navigation.openSettings(plan.page)
      return
    case 'set-theme-pref':
      await themeStore.getState().setPref(plan.pref)
      return
    case 'set-lang-pref':
      await i18nStore.getState().setPref(plan.pref)
      return
    case 'clear-recent-workspaces':
      await clearRecentWorkspaceHistory()
      return
    case 'ensure-recent-workspace-open': {
      const navigationGeneration = beginAppNavigation()
      const result = await deps.openWorkspaceMembership(plan.entry)
      if (result.ok) {
        reportOpenWorkspacePostOpenEffects(result, deps.t)
        if (!appNavigationIsCurrent(navigationGeneration)) return
        deps.navigation.activateWorkspace(result.workspaceId, { navigationGeneration })
      } else {
        reportOpenWorkspaceUncertainty(result, deps.t)
      }
      return
    }
    case 'open-workspace':
      await openWorkspaceFromDialog({
        openWorkspaceMembership: deps.openWorkspaceMembership,
        activateWorkspace: deps.navigation.activateWorkspace,
        openWorkspacePathDialog: deps.openWorkspacePathDialog,
        t: deps.t,
      })
      return
    case 'open-workspace-path':
      deps.openWorkspacePathDialog()
      return
    case 'open-clone-repo':
      deps.openCloneRepo()
      return
    case 'open-remote-workspace':
      deps.openRemoteWorkspace()
      return
    case 'reset-layout':
      deps.resetLayout()
      return
  }
}

export async function handleWorkspaceClientIntent(
  event: ClientWorkspaceIntent,
  deps: WorkspaceClientIntentDeps,
): Promise<boolean> {
  // Workspace intents are route-aware and may be gated by overlays, shortcut
  // suppression, or terminal focus before they execute.
  const currentWorkspace = deps.currentWorkspace
  const plan = createWorkspaceIntentPlan(event, {
    overlayBlocked: deps.overlayBlocked,
    workspaceShortcutSuppressed: deps.workspaceShortcutSuppressed,
    terminalFocused: deps.terminalFocused,
    currentWorkspaceId: currentWorkspace?.id ?? null,
    currentWorkspaceRuntimeId: currentWorkspace?.workspaceRuntimeId ?? null,
    currentWorkspaceCapability: currentWorkspace?.capability ?? null,
    currentWorkspaceCanExecute: currentWorkspace ? workspaceCanExecute(currentWorkspace) : false,
    currentWorkspacePaneCommandTarget: deps.currentWorkspacePaneCommandTarget,
  })
  switch (plan.kind) {
    case 'noop':
      return true
    case 'create-worktree': {
      if (!currentWorkspace || currentWorkspace.capability.kind !== 'git') return true
      const branchAction = projectBranchActionOperation(
        currentWorkspace.capability.git.operations.branchAction,
        getRepoOperationsQueryData(currentWorkspace.id, currentWorkspace.workspaceRuntimeId)?.operations,
      )
      if (branchAction.phase !== 'idle') {
        toast.error(deps.t('action.create-worktree-busy'))
        return true
      }
      deps.openCreateWorktree()
      return true
    }
    case 'new-terminal-tab':
      // Cmd+T / File → New Terminal Tab is a generic entry — the new
      // terminal should append to the end of the strip rather than being
      // anchored to the currently-active tab.
      return await runNewTerminalTabCommand({
        workspaceId: plan.workspaceId,
        target: plan.target,
        navigation: deps.navigation,
        t: deps.t,
      })
    case 'close-workspace-pane-tab':
      await runCloseCurrentWorkspacePaneTabCommand({
        workspaceId: plan.workspaceId,
        target: plan.target,
        navigation: deps.navigation,
      })
      return true
    case 'close-workspace': {
      const closeResult = await deps.navigation.closeWorkspace(plan.workspaceId)
      reportCloseWorkspaceFailure(closeResult, deps.t)
      return closeResult.ok
    }
    case 'cycle-workspace':
      deps.navigation.cycleWorkspace(plan.direction)
      return true
    case 'refresh-workspace':
      const refreshOutcome = await runWorkspaceRefresh(
        { get: workspacesStore.getState, set: workspacesStore.setState },
        plan.workspaceId,
        {
          workspaceRuntimeId: plan.workspaceRuntimeId,
        },
      )
      return presentWorkspaceRefreshOutcome(refreshOutcome, deps.t)
    case 'show-workspace-pane-tab':
      if (plan.tab === 'terminal') {
        return await runTerminalPrimaryActionCommand({
          workspaceId: plan.workspaceId,
          target: plan.target,
          navigation: deps.navigation,
          t: deps.t,
        })
      }
      return await runShowWorkspacePaneTabCommand({
        workspaceId: plan.workspaceId,
        target: plan.target,
        tab: plan.tab,
        navigation: deps.navigation,
      })
    case 'terminal-primary-action':
      return await runTerminalPrimaryActionCommand({
        workspaceId: plan.workspaceId,
        target: plan.target,
        navigation: deps.navigation,
        t: deps.t,
      })
    case 'toggle-zen-mode':
      deps.toggleZenMode()
      return true
  }
}

export function createExternalOpenIntentDrainer(deps: ExternalOpenIntentDrainerDeps): {
  drain: () => void
  dispose: () => void
} {
  let disposed = false
  let draining = false
  let rerun = false

  const drain = () => {
    const kickPlan = createExternalOpenDrainKickPlan({ disposed, draining })
    switch (kickPlan.kind) {
      case 'ignore':
        return
      case 'schedule-rerun':
        rerun = true
        return
      case 'start-drain':
        break
    }
    draining = true
    void (async () => {
      try {
        while (!disposed) {
          rerun = false
          const paths = await consumeExternalOpenPaths()
          if (paths.length === 0) break
          await openWorkspacePaths(paths, {
            openWorkspaceMembership: deps.openWorkspaceMembership,
            activateWorkspace: deps.activateWorkspace,
            onOpenFailed: (path, result) => {
              if (!reportOpenWorkspaceUncertainty(result, deps.t, { descriptionPrefix: path })) {
                toast.error(deps.t('drop.open-failed'), {
                  description: `${path}\n${deps.t(result.message)}`,
                })
              }
            },
            onPostOpenError: (path, error) => {
              reportOpenWorkspacePostOpenError(error, deps.t, { descriptionPrefix: path })
            },
          })
          if (!rerun) break
        }
      } catch (err) {
        externalOpenLog.warn('failed to drain queued paths', { err })
      } finally {
        draining = false
        if (rerun && !disposed) drain()
      }
    })()
  }

  return {
    drain,
    dispose() {
      disposed = true
    },
  }
}
