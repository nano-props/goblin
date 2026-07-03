import { toast } from 'sonner'
import { isShortcutBlockingLayerOpen } from '#/web/lib/layers.ts'
import { isTerminalFocused } from '#/web/terminal-focus.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useThemeStore } from '#/web/stores/theme.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { clearRecentRepoHistory } from '#/web/settings-actions.ts'
import { openRepoFromDialog } from '#/web/lib/open-repo-dialog.ts'
import { reportOpenRepoPostOpenEffects } from '#/web/lib/open-repo-result-feedback.ts'
import { consumeExternalOpenPaths } from '#/web/app-shell-client.ts'
import { openRepoPaths } from '#/web/lib/open-repo-paths.ts'
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
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { OpenRepoResult } from '#/web/stores/repos/types.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import { readRepoBranchQueryProjection, repoWithBranchReadModel } from '#/web/repo-branch-read-model.ts'

interface TerminalBellIntentDeps {
  navigation: PrimaryWindowNavigationActions
  closeAllOverlays: () => void
  setSelectedTerminal: (terminalWorktreeKey: string, terminalSessionId: string) => void
}

interface SharedClientIntentDeps {
  navigation: PrimaryWindowNavigationActions
  currentRepoId: string | null
  closeAllOverlays: () => void
  openRepoPathDialog: () => void
  openCloneRepo: () => void
  openRemoteRepo: () => void
  openCreateWorktree: () => void
  isOverlayOpen: () => boolean
  isWorkspaceShortcutSuppressed: () => boolean
  ensureWorkspaceOpen: (input: string | RepoSessionEntry) => Promise<OpenRepoResult>
  setSelectedTerminal: (terminalWorktreeKey: string, terminalSessionId: string) => void
  resetLayout: () => void
  toggleZenMode: () => void
  t: (key: string) => string
}

interface ExternalOpenIntentDrainerDeps {
  ensureWorkspaceOpen: (path: string) => Promise<OpenRepoResult>
  activateRepo: (repoId: string) => void
  t: (key: string) => string
}

export function handleTerminalBellClickIntent(
  event: Extract<ClientEffectIntent, { type: 'terminal-bell-click' }>,
  deps: TerminalBellIntentDeps,
): void {
  const repo = useReposStore.getState().repos[event.repoRoot]
  const branchModel = repo && event.terminalWorktreeKey ? readRepoBranchQueryProjection(repo) : null
  const plan = createTerminalBellIntentPlan(
    repo && (!event.terminalWorktreeKey || branchModel) ? repoWithBranchReadModel(repo, branchModel) : undefined,
    event,
  )
  if (plan.kind === 'noop') return
  deps.closeAllOverlays()
  switch (plan.kind) {
    case 'show-worktree-terminal':
      deps.setSelectedTerminal(plan.terminalWorktreeKey, plan.terminalSessionId)
      deps.navigation.showRepoBranchWorkspacePaneTab(plan.repoId, plan.branch, 'terminal')
      return
    case 'show-repo-terminal':
      deps.navigation.showRepoWorkspacePaneTab(plan.repoId, 'terminal')
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
    case 'clear-recent-repos':
      await clearRecentRepoHistory()
      return true
    case 'ensure-recent-repo-open': {
      const result = await deps.ensureWorkspaceOpen(plan.entry)
      if (result.ok) {
        reportOpenRepoPostOpenEffects(result, deps.t)
        deps.navigation.activateRepo(result.id)
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
  const currentRepo = deps.currentRepoId ? (useReposStore.getState().repos[deps.currentRepoId] ?? null) : null
  const plan = createWorkspaceIntentPlan(event, {
    overlayBlocked: deps.isOverlayOpen() || isShortcutBlockingLayerOpen(),
    workspaceShortcutSuppressed: deps.isWorkspaceShortcutSuppressed(),
    terminalFocused: isTerminalFocused(),
    currentRepoId: deps.currentRepoId,
    currentRepo,
  })
  if (!plan) return false
  switch (plan.kind) {
    case 'noop':
      return true
    case 'open-repo':
      await openRepoFromDialog({
        ensureWorkspaceOpen: async (path) => await deps.ensureWorkspaceOpen(path),
        activateRepo: deps.navigation.activateRepo,
        openRepoPathDialog: deps.openRepoPathDialog,
        t: deps.t,
      })
      return true
    case 'open-repo-path':
      deps.openRepoPathDialog()
      return true
    case 'open-clone-repo':
      deps.openCloneRepo()
      return true
    case 'open-remote-repo':
      deps.openRemoteRepo()
      return true
    case 'create-worktree': {
      if (!currentRepo) return true
      if (currentRepo.operations.branchAction.phase !== 'idle') {
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
        repoId: plan.repoId,
        navigation: deps.navigation,
        t: deps.t,
      })
    case 'close-workspace-pane-tab-or-window':
      return await runCloseWorkspacePaneTabOrWindowCommand({ repoId: plan.repoId, navigation: deps.navigation })
    case 'close-repo':
      deps.navigation.closeRepo(plan.repoId)
      return true
    case 'close-window':
      window.close()
      return true
    case 'cycle-repo':
      deps.navigation.cycleRepo(plan.direction)
      return true
    case 'refresh-repo':
      await runRepoRefreshIntent(useReposStore.getState, {
        kind: 'manual-refresh-requested',
        id: plan.repoId,
        repoInstanceId: plan.repoInstanceId,
      })
      return true
    case 'show-workspace-pane-tab':
      return await runShowWorkspacePaneTabCommand({
        repoId: plan.repoId,
        tab: plan.tab,
        navigation: deps.navigation,
      })
    case 'terminal-primary-action':
      return await runTerminalPrimaryActionCommand({
        repoId: plan.repoId,
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
          await openRepoPaths(paths, {
            ensureWorkspaceOpen: deps.ensureWorkspaceOpen,
            activateRepo: deps.activateRepo,
            onOpenFailed: (path, message) => {
              const openErrorMessage = deps.t(message)
              toast.error(deps.t('drop.open-failed'), {
                description: `${path}\n${openErrorMessage}`,
              })
            },
            onPostOpenError: (path, message) => {
              toast.error(deps.t('repo-picker.recent-save-failed'), {
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
