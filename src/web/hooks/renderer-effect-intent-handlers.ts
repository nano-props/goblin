import { toast } from 'sonner'
import { isShortcutBlockingLayerOpen } from '#/web/lib/layers.ts'
import { isTerminalFocused } from '#/web/terminal-focus.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useThemeStore } from '#/web/stores/theme.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { clearRecentRepoHistory } from '#/web/settings-write-paths.ts'
import { openRepoFromDialog } from '#/web/lib/open-repo-dialog.ts'
import { consumeExternalOpenPaths } from '#/web/app-shell-client.ts'
import { openRepoPaths } from '#/web/lib/open-repo-paths.ts'
import { externalOpenLog } from '#/web/logger.ts'
import {
  runCloseWorkspacePaneTabOrWindowCommand,
  runNewTerminalTabCommand,
  runShowWorkspacePaneViewCommand,
  runTerminalPrimaryActionCommand,
} from '#/web/commands/workspace-commands.ts'
import {
  createAppLevelIntentPlan,
  createExternalOpenDrainKickPlan,
  createTerminalBellIntentPlan,
  createWorkspaceIntentPlan,
} from '#/web/hooks/renderer-effect-intent-plans.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import type { OpenRepoResult } from '#/web/stores/repos/types.ts'
import type { RendererEffectIntent } from '#/shared/renderer-effect-intents.ts'

interface TerminalBellIntentDeps {
  navigation: MainWindowNavigationActions
  closeAllOverlays: () => void
  setSelectedTerminal: (worktreeKey: string, key: string) => void
}

interface SharedRendererIntentDeps {
  navigation: MainWindowNavigationActions
  currentRepoId: string | null
  closeAllOverlays: () => void
  openRepoPathDialog: () => void
  openCloneRepo: () => void
  openRemoteRepo: () => void
  isOverlayOpen: () => boolean
  isWorkspaceShortcutSuppressed: () => boolean
  ensureWorkspaceOpen: (input: string | RepoSessionEntry) => Promise<OpenRepoResult>
  setSelectedTerminal: (worktreeKey: string, key: string) => void
  resetLayout: () => void
  toggleWorkspaceFocused: () => void
  t: (key: string) => string
}

interface ExternalOpenIntentDrainerDeps {
  ensureWorkspaceOpen: (path: string) => Promise<OpenRepoResult>
  activateRepo: (repoId: string) => void
  t: (key: string) => string
}

export function handleTerminalBellClickIntent(
  event: Extract<RendererEffectIntent, { type: 'terminal-bell-click' }>,
  deps: TerminalBellIntentDeps,
): void {
  const plan = createTerminalBellIntentPlan(useReposStore.getState().repos[event.repoRoot], event)
  if (plan.kind === 'noop') return
  deps.closeAllOverlays()
  switch (plan.kind) {
    case 'show-worktree-terminal':
      deps.setSelectedTerminal(plan.worktreeTerminalKey, plan.key)
      deps.navigation.showRepoBranchWorkspacePaneView(plan.repoId, plan.branch, 'terminal')
      return
    case 'show-repo-terminal':
      deps.navigation.showRepoWorkspacePaneView(plan.repoId, 'terminal')
      return
  }
}

export async function handleAppLevelRendererIntent(
  event: RendererEffectIntent,
  deps: SharedRendererIntentDeps,
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
      if (result.ok) deps.navigation.activateRepo(result.id)
      return true
    }
    case 'reset-layout':
      deps.resetLayout()
      return true
  }
}

export async function handleWorkspaceRendererIntent(
  event: RendererEffectIntent,
  deps: SharedRendererIntentDeps,
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
    case 'new-terminal-tab':
      return await runNewTerminalTabCommand({
        repoId: plan.repoId,
        navigation: deps.navigation,
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
        token: plan.token,
      })
      return true
    case 'show-workspace-pane-view':
      return await runShowWorkspacePaneViewCommand({
        repoId: plan.repoId,
        tab: plan.tab,
        navigation: deps.navigation,
      })
    case 'terminal-primary-action':
      return await runTerminalPrimaryActionCommand({
        repoId: plan.repoId,
        navigation: deps.navigation,
      })
    case 'toggle-workspace-focus':
      deps.toggleWorkspaceFocused()
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
              toast.error(deps.t('drop.open-failed'), {
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
