import { toast } from 'sonner'
import { isShortcutBlockingLayerOpen } from '#/web/lib/layers.ts'
import { isTerminalFocused } from '#/web/terminal-focus.ts'
import { runManualRepoSync } from '#/web/stores/workspaces/refresh.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useThemeStore } from '#/web/stores/theme.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { clearRecentWorkspaceHistory } from '#/web/settings-actions.ts'
import { openWorkspaceFromDialog } from '#/web/lib/open-workspace-dialog.ts'
import { reportOpenWorkspacePostOpenEffects } from '#/web/lib/open-workspace-result-feedback.ts'
import { consumeExternalOpenPaths } from '#/web/app-shell-client.ts'
import { openWorkspacePaths } from '#/web/lib/open-workspace-paths.ts'
import { externalOpenLog } from '#/web/logger.ts'
import {
  runCloseWorkspacePaneTabOrWindowCommand,
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
import type { WorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { OpenWorkspaceResult } from '#/web/stores/workspaces/types.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { getRepoOperationsQueryData } from '#/web/repo-data-query.ts'
import { projectBranchActionOperation } from '#/web/hooks/branch-action-state.ts'
import { dispatchShowWorkspacePaneTerminalRouteAction } from '#/web/workspace-pane/workspace-pane-tab-select-action.ts'
import {
  workspacePaneCommandCoordinates,
  type WorkspacePaneCommandTarget,
} from '#/web/workspace-pane/workspace-pane-command-target.ts'

interface TerminalBellIntentDeps {
  navigation: PrimaryWindowNavigationActions
  closeAllOverlays: () => void
}

interface SharedClientIntentDeps {
  navigation: PrimaryWindowNavigationActions
  currentWorkspaceId: string | null
  currentWorkspacePaneCommandTarget: WorkspacePaneCommandTarget | null
  closeAllOverlays: () => void
  openWorkspacePathDialog: () => void
  openCloneRepo: () => void
  openRemoteWorkspace: () => void
  openCreateWorktree: () => void
  isOverlayOpen: () => boolean
  isWorkspaceShortcutSuppressed: () => boolean
  ensureWorkspaceOpen: (input: string | WorkspaceSessionEntry) => Promise<OpenWorkspaceResult>
  resetLayout: () => void
  toggleZenMode: () => void
  t: (key: string) => string
}

interface ExternalOpenIntentDrainerDeps {
  ensureWorkspaceOpen: (path: string) => Promise<OpenWorkspaceResult>
  activateWorkspace: (workspaceId: string) => void
  t: (key: string) => string
}

export function handleTerminalBellClickIntent(
  event: Extract<ClientEffectIntent, { type: 'terminal-bell-click' }>,
  deps: TerminalBellIntentDeps,
): void {
  const repo = useWorkspacesStore.getState().workspaces[event.repoRoot]
  const branchModel = repo && event.terminalWorktreeKey ? readRepoBranchQueryProjection(repo) : null
  const plan = createTerminalBellIntentPlan(repo, branchModel, event)
  if (plan.kind === 'noop' || plan.kind === 'unavailable') return
  deps.closeAllOverlays()
  switch (plan.kind) {
    case 'show-worktree-terminal':
      void dispatchShowWorkspacePaneTerminalRouteAction({
        workspaceId: plan.repoId,
        branchName: plan.branch,
        terminalSessionId: plan.terminalSessionId,
        navigation: deps.navigation,
      })
      return
    case 'show-detached-worktree-terminal':
      deps.navigation.showRepoWorktreeTerminalSession?.(plan.repoId, plan.worktreePath, plan.terminalSessionId)
      return
  }
}

export async function handleAppLevelClientIntent(
  event: ClientEffectIntent,
  deps: SharedClientIntentDeps,
): Promise<boolean> {
  // App-level intents are allowed even when no workspace repo is visible.
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
      await useThemeStore.getState().setPref(plan.pref)
      return true
    case 'set-lang-pref':
      await useI18nStore.getState().setPref(plan.pref)
      return true
    case 'clear-recent-workspaces':
      await clearRecentWorkspaceHistory()
      return true
    case 'ensure-recent-workspace-open': {
      const result = await deps.ensureWorkspaceOpen(plan.entry)
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
  const currentRepo = deps.currentWorkspaceId
    ? (useWorkspacesStore.getState().workspaces[deps.currentWorkspaceId] ?? null)
    : null
  const plan = createWorkspaceIntentPlan(event, {
    overlayBlocked: deps.isOverlayOpen() || isShortcutBlockingLayerOpen(),
    workspaceShortcutSuppressed: deps.isWorkspaceShortcutSuppressed(),
    terminalFocused: isTerminalFocused(),
    currentWorkspaceId: deps.currentWorkspaceId,
    currentWorkspaceRuntimeId: currentRepo?.workspaceRuntimeId ?? null,
    currentWorkspaceCapability: currentRepo?.capability ?? null,
    currentWorkspacePaneCommandTarget: deps.currentWorkspacePaneCommandTarget,
  })
  if (!plan) return false
  switch (plan.kind) {
    case 'noop':
      return true
    case 'open-workspace':
      await openWorkspaceFromDialog({
        ensureWorkspaceOpen: async (path) => await deps.ensureWorkspaceOpen(path),
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
      if (!currentRepo || currentRepo.capability.kind !== 'git') return true
      const branchAction = projectBranchActionOperation(
        currentRepo.capability.git.operations.branchAction,
        getRepoOperationsQueryData(currentRepo.id, currentRepo.workspaceRuntimeId)?.operations,
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
    case 'close-workspace-pane-tab-or-window':
      return await runCloseWorkspacePaneTabOrWindowCommand({
        workspaceId: plan.workspaceId,
        target: plan.target,
        navigation: deps.navigation,
      })
    case 'close-workspace':
      const closeResult = await deps.navigation.closeWorkspace(plan.workspaceId)
      if (!closeResult.ok) toast.error(deps.t(closeResult.message))
      return closeResult.ok
    case 'close-window':
      window.close()
      return true
    case 'cycle-workspace':
      deps.navigation.cycleWorkspace(plan.direction)
      return true
    case 'refresh-repo':
      await runManualRepoSync({ get: useWorkspacesStore.getState, set: useWorkspacesStore.setState }, plan.repoId, {
        workspaceRuntimeId: plan.workspaceRuntimeId,
      })
      return true
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
            ensureWorkspaceOpen: deps.ensureWorkspaceOpen,
            activateWorkspace: deps.activateWorkspace,
            onOpenFailed: (path, message) => {
              const openErrorMessage = deps.t(message)
              toast.error(deps.t('drop.open-failed'), {
                description: `${path}\n${openErrorMessage}`,
              })
            },
            onPostOpenError: (path, message) => {
              toast.error(deps.t('workspace-picker.recent-save-failed'), {
                description: `${path}\n${deps.t(message)}`,
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
