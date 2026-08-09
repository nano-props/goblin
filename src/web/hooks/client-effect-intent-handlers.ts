import { toast } from 'vue-sonner'
import { isShortcutBlockingLayerOpen } from '#/web/lib/layers.ts'
import { terminalHasKeyboardFocus } from '#/web/terminal-focus.ts'
import { runWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import { presentWorkspaceRefreshOutcome } from '#/web/workspace-refresh-feedback.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspaceCanExecute } from '#/web/stores/workspaces/workspace-guards.ts'
import { themeStore } from '#/web/stores/theme.ts'
import { i18nStore } from '#/web/stores/i18n.ts'
import { clearRecentWorkspaceHistory } from '#/web/settings-actions.ts'
import { openWorkspaceFromDialog } from '#/web/lib/open-workspace-dialog.ts'
import { reportOpenWorkspacePostOpenEffects } from '#/web/lib/open-workspace-result-feedback.ts'
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
} from '#/web/hooks/client-effect-intent-plans.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import type { OpenWorkspaceResult } from '#/web/stores/workspaces/types.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { terminalSessionCoordinates } from '#/shared/terminal-types.ts'
import { getRepoOperationsQueryData, getRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import { projectBranchActionOperation } from '#/web/hooks/branch-action-state.ts'
import { dispatchShowWorkspacePaneTerminalRouteAction } from '#/web/workspace-pane/workspace-pane-tab-select-action.ts'
import {
  workspacePaneCommandCoordinates,
  type WorkspacePaneCommandTarget,
} from '#/web/workspace-pane/workspace-pane-command-target.ts'

interface TerminalBellIntentDeps {
  navigation: AppNavigationActions
  closeAllOverlays: () => void
}

interface SharedClientIntentDeps {
  navigation: AppNavigationActions
  currentWorkspaceId: string | null
  currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null
  openWorkspacePathDialog: () => void
  openCloneRepo: () => void
  openRemoteWorkspace: () => void
  openCreateWorktree: () => void
  isOverlayOpen: () => boolean
  isWorkspaceShortcutSuppressed: () => boolean
  openWorkspaceMembership: (input: string | WorkspaceSessionEntry) => Promise<OpenWorkspaceResult>
  resetLayout: () => void
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
  const workspaceId = terminalSessionCoordinates(event.session).workspaceId
  const workspace = workspacesStore.getState().workspaces[workspaceId]
  const snapshot = workspace ? getRepoSnapshotQueryData(workspace.id, workspace.workspaceRuntimeId) : undefined
  const repositoryFacts = snapshot ? { snapshot } : null
  const plan = createTerminalBellIntentPlan(workspace, repositoryFacts, event)
  if (plan.kind === 'noop' || plan.kind === 'unavailable') return
  deps.closeAllOverlays()
  switch (plan.kind) {
    case 'show-workspace-root-terminal':
      deps.navigation.showWorkspaceRootPaneTab(plan.workspaceId, {
        kind: 'terminal',
        terminalSessionId: plan.terminalSessionId,
      })
      return
    case 'show-worktree-terminal':
      void dispatchShowWorkspacePaneTerminalRouteAction({
        workspaceId: plan.workspaceId,
        branchName: plan.branch,
        terminalSessionId: plan.terminalSessionId,
        navigation: deps.navigation,
      })
      return
    case 'show-detached-worktree-terminal':
      deps.navigation.showRepoWorktreeTerminalSession(plan.workspaceId, plan.worktreePath, plan.terminalSessionId)
      return
  }
}

export async function handleAppLevelClientIntent(
  event: ClientEffectIntent,
  deps: SharedClientIntentDeps,
): Promise<boolean> {
  // App-level intents are allowed even when no workspace is visible.
  const plan = createAppLevelIntentPlan(event, {
    overlayBlocked: deps.isOverlayOpen() || isShortcutBlockingLayerOpen(),
  })
  if (!plan) return false
  switch (plan.kind) {
    case 'noop':
      return true
    case 'open-settings':
      deps.navigation.openSettings(plan.page)
      return true
    case 'set-theme-pref':
      await themeStore.getState().setPref(plan.pref)
      return true
    case 'set-lang-pref':
      await i18nStore.getState().setPref(plan.pref)
      return true
    case 'clear-recent-workspaces':
      await clearRecentWorkspaceHistory()
      return true
    case 'ensure-recent-workspace-open': {
      const result = await deps.openWorkspaceMembership(plan.entry)
      if (result.ok) {
        reportOpenWorkspacePostOpenEffects(result, deps.t)
        deps.navigation.activateWorkspace(result.workspaceId)
      }
      return true
    }
    case 'reset-layout':
      deps.resetLayout()
      return true
  }
}

export async function handleWorkspaceClientIntent(
  event: ClientEffectIntent,
  deps: SharedClientIntentDeps,
): Promise<boolean> {
  // Workspace intents are route-aware and may be gated by overlays, shortcut
  // suppression, or terminal focus before they execute.
  const currentWorkspace = deps.currentWorkspaceId
    ? (workspacesStore.getState().workspaces[deps.currentWorkspaceId] ?? null)
    : null
  const plan = createWorkspaceIntentPlan(event, {
    overlayBlocked: deps.isOverlayOpen() || isShortcutBlockingLayerOpen(),
    workspaceShortcutSuppressed: deps.isWorkspaceShortcutSuppressed(),
    terminalFocused: terminalHasKeyboardFocus(),
    currentWorkspaceId: currentWorkspace?.id ?? null,
    currentWorkspaceRuntimeId: currentWorkspace?.workspaceRuntimeId ?? null,
    currentWorkspaceCapability: currentWorkspace?.capability ?? null,
    currentWorkspaceCanExecute: currentWorkspace ? workspaceCanExecute(currentWorkspace) : false,
    currentWorkspacePaneCommandTarget: deps.currentWorkspacePaneCommandTarget,
  })
  if (!plan) return false
  switch (plan.kind) {
    case 'noop':
      return true
    case 'open-workspace':
      await openWorkspaceFromDialog({
        openWorkspaceMembership: deps.openWorkspaceMembership,
        activateWorkspace: deps.navigation.activateWorkspace,
        openWorkspacePathDialog: deps.openWorkspacePathDialog,
        t: deps.t,
      })
      return true
    case 'open-workspace-path':
      deps.openWorkspacePathDialog()
      return true
    case 'open-clone-repo':
      deps.openCloneRepo()
      return true
    case 'open-remote-workspace':
      deps.openRemoteWorkspace()
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
      if (!closeResult.ok) {
        const closeErrorKey = closeResult.message
        toast.error(deps.t(closeErrorKey))
      }
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
            onOpenFailed: (path, messageKey) => {
              const openErrorMessage = deps.t(messageKey)
              toast.error(deps.t('drop.open-failed'), {
                description: `${path}\n${openErrorMessage}`,
              })
            },
            onPostOpenError: (path, messageKey) => {
              toast.error(deps.t('workspace-picker.recent-save-failed'), {
                description: `${path}\n${deps.t(messageKey)}`,
              })
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
