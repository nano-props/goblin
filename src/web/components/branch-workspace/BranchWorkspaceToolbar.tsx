import { useCallback, useMemo, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '#/web/stores/i18n.ts'
import { Toolbar } from '#/web/components/Layout.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { terminalLog } from '#/web/logger.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-slot-keys.ts'
import { useTerminalRepoSyncReady, useWorktreeTerminalSnapshot } from '#/web/components/terminal/terminal-slot-store.ts'
import { useTerminalSlotContext } from '#/web/components/terminal/terminal-slot-context.ts'
import {
  WorkspacePaneViewStrip,
  EMPTY_WORKSPACE_PANE_VIEW_FOCUS_KEY,
  createPendingWorkspacePaneTabItem,
  createStaticWorkspacePaneTabItem,
  createTerminalWorkspacePaneTabItem,
  isPendingWorkspacePaneTabItem,
  isStaticWorkspacePaneTabItem,
  isTerminalWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/WorkspacePaneViewStrip.tsx'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import type { WorkspacePaneStaticViewType, WorkspacePaneTabOrderEntry } from '#/shared/workspace-pane.ts'
import type { TerminalSlotBase } from '#/web/components/terminal/types.ts'
import type {
  BranchWorkspaceRepo,
  SelectedBranchWorkspacePresentation,
} from '#/web/components/branch-workspace/model.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { useIsInitialSyncInFlight } from '#/web/stores/repo-sync.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneTabOrderForBranch } from '#/web/stores/repos/workspace-pane-tabs.ts'
import { preferredWorkspacePaneViewForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import { createBranchWorkspacePaneTabModel } from '#/web/components/branch-workspace/workspace-pane-tab-model.ts'
import { createWorkspacePaneTerminalTab } from '#/web/stores/repos/workspace-pane-terminal-write-paths.ts'
import {
  terminalWorkspacePaneTabProvider,
  workspacePaneStaticTabProvider,
} from '#/web/workspace-pane/workspace-pane-tab-providers.ts'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'
import { cn } from '#/web/lib/cn.ts'

interface Props {
  repo: Pick<BranchWorkspaceRepo, 'id' | 'ui' | 'data'>
  detail: SelectedBranchWorkspacePresentation
  workspacePaneId: string
  leading?: ReactNode
  trafficLightOffset?: boolean
}

export function BranchWorkspaceToolbar({ repo, detail, workspacePaneId, leading, trafficLightOffset = false }: Props) {
  const t = useT()
  const navigation = useMainWindowNavigation()
  const compact = useIsCompactUi()
  const clearSelectedBranch = useReposStore((s) => s.clearSelectedBranch)
  // While the first server-side session list for this repo is in flight,
  // keep the New Terminal affordance visible but busy. Hooks into the
  // repo-sync store which the Provider updates via markReady() at the end
  // of every syncServerSlots.
  const isInitialSyncInFlight = useIsInitialSyncInFlight(repo.id)
  const terminalWorktreeKey = detail.branch?.worktree?.path
    ? worktreeTerminalKey(repo.id, detail.branch.worktree.path)
    : null
  const branchName = detail.branch?.name ?? null
  const worktreePath = detail.branch?.worktree?.path ?? null
  const preferredWorkspacePaneView = preferredWorkspacePaneViewForBranch(repo.ui, branchName)
  const showBranchLevelTabs = !!detail.branch

  const { createTerminal, selectTerminal, scrollToBottom } = useTerminalSlotContext()

  const worktreeSnapshot = useWorktreeTerminalSnapshot(terminalWorktreeKey)
  const terminalSyncReady = useTerminalRepoSyncReady(repo.id)
  const workspacePaneTabOrder = useMemo(
    () => workspacePaneTabOrderForBranch(repo.ui, branchName),
    [branchName, repo.ui.workspacePaneTabOrderByBranch],
  )
  const workspacePaneTabModel = useMemo(
    () =>
      createBranchWorkspacePaneTabModel({
        repoId: repo.id,
        branchName,
        worktreePath,
        preferredView: preferredWorkspacePaneView,
        tabOrder: workspacePaneTabOrder,
        runtimeTerminalViews: worktreeSnapshot.slots,
        terminalSessionCount: worktreeSnapshot.count,
        terminalCreatePending: worktreeSnapshot.pendingCreate,
        terminalSyncReady,
        lastClosedTabContext: branchName ? (repo.ui.lastClosedTabContextByBranch[branchName] ?? null) : null,
      }),
    [
      branchName,
      workspacePaneTabOrder,
      repo.id,
      preferredWorkspacePaneView,
      terminalSyncReady,
      worktreePath,
      worktreeSnapshot.count,
      worktreeSnapshot.pendingCreate,
      worktreeSnapshot.slots,
      repo.ui.lastClosedTabContextByBranch,
    ],
  )
  const workspacePaneTabFocusRegistry = useFocusRegistry<string, HTMLButtonElement>()

  const terminalBase = useMemo<TerminalSlotBase | null>(
    () =>
      detail.branch?.worktree?.path
        ? { repoRoot: repo.id, branch: detail.branch.name, worktreePath: detail.branch.worktree.path }
        : null,
    [repo.id, detail.branch],
  )

  // Shared "enter the terminal view" effect for any terminal-targeting action:
  // set the user's preferred tab to terminal (when not already there) and
  // uncollapse the pane. Callers add their own follow-up command
  // (create/select/scroll). Whether the terminal view is *renderable*
  // (worktree + sessions) is decided at read time by
  // the shared workspace pane tab model — we only assert user intent here.
  const enterTerminalTab = useCallback(() => {
    if (preferredWorkspacePaneView !== 'terminal') {
      navigation.showRepoWorkspacePaneView(repo.id, 'terminal')
    }
  }, [navigation, repo.id, preferredWorkspacePaneView])

  const handleNewTerminal = useCallback(() => {
    if (!terminalBase) return
    enterTerminalTab()
    void createWorkspacePaneTerminalTab({ base: terminalBase, createTerminal }).catch((err) => {
      terminalLog.warn('failed to create terminal', { err })
      const message = err instanceof Error ? err.message : 'error.terminal-create-failed'
      toast.error(t('action.result-error'), { description: t(message) })
    })
  }, [createTerminal, terminalBase, enterTerminalTab, t])

  const showWorkspacePaneTabItem = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (isStaticWorkspacePaneTabItem(item)) {
        navigation.showRepoWorkspacePaneView(repo.id, item.staticViewType)
        return
      }
      if (isTerminalWorkspacePaneTabItem(item)) {
        enterTerminalTab()
        selectTerminal(item.view.worktreeTerminalKey, item.view.key)
        return
      }
    },
    [enterTerminalTab, navigation, repo.id, selectTerminal],
  )

  const handleScrollToBottom = useCallback(
    (key: string) => {
      enterTerminalTab()
      scrollToBottom(key)
    },
    [enterTerminalTab, scrollToBottom],
  )

  const handleReorderWorkspacePaneViewStrip = useCallback(
    (orderedTabs: WorkspacePaneTabOrderEntry[]) => {
      useReposStore.getState().reorderWorkspacePaneTabs(repo.id, orderedTabs, branchName ?? undefined)
    },
    [branchName, repo.id],
  )

  const workspacePaneTabItems = useMemo<WorkspacePaneTabItem[]>(
    () =>
      workspacePaneTabModel.tabs.map((tab) => {
        if (tab.kind === 'static') {
          const metadata = { t, branchName: branchName ?? '', statusCount: detail.statusCount }
          const type = tab.type as WorkspacePaneStaticViewType
          const provider = workspacePaneStaticTabProvider(type)
          return createStaticWorkspacePaneTabItem({
            type,
            label: provider.label(metadata),
            tooltip: provider.tooltip(metadata),
            closeLabel: provider.closeLabel(metadata),
            panelId: provider.panelId(workspacePaneId),
          })
        }
        if (tab.kind === 'pending') {
          const label = terminalWorkspacePaneTabProvider.pendingLabel({
            t,
            terminalCreatePending: worktreeSnapshot.pendingCreate,
            terminalSyncReady,
          })
          return createPendingWorkspacePaneTabItem({
            type: tab.type,
            label,
            tooltip: label,
            panelId: terminalWorkspacePaneTabProvider.panelId(workspacePaneId),
          })
        }
        const metadata = {
          t,
          branchName: branchName ?? '',
          statusCount: detail.statusCount,
          view: tab.view,
        }
        return createTerminalWorkspacePaneTabItem({
          view: tab.view,
          label: terminalWorkspacePaneTabProvider.label(metadata),
          tooltip: terminalWorkspacePaneTabProvider.tooltip(metadata),
          closeLabel: terminalWorkspacePaneTabProvider.closeLabel(metadata),
          panelId: terminalWorkspacePaneTabProvider.panelId(workspacePaneId),
        })
      }),
    [
      branchName,
      detail.statusCount,
      terminalSyncReady,
      t,
      worktreeSnapshot.pendingCreate,
      workspacePaneTabModel.tabs,
      workspacePaneId,
    ],
  )
  const activeTabIdentity = workspacePaneTabModel.activeTab?.identity ?? null
  const handleSelectWorkspacePaneTabItem = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (isPendingWorkspacePaneTabItem(item)) return
      if (isTerminalWorkspacePaneTabItem(item) && item.identity === activeTabIdentity) {
        handleScrollToBottom(item.view.key)
        return
      }
      showWorkspacePaneTabItem(item)
    },
    [activeTabIdentity, handleScrollToBottom, showWorkspacePaneTabItem],
  )
  const handleCloseWorkspacePaneView = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (isPendingWorkspacePaneTabItem(item)) return
      void runCloseWorkspacePaneTabCommand({
        repoId: repo.id,
        targetIdentity: item.identity,
        navigation,
      })
    },
    [navigation, repo.id],
  )

  const toolbarClassName = cn(
    'goblin-workspace-toolbar',
    trafficLightOffset ? 'topbar' : 'app-drag-region px-2',
    'border-border/60 bg-card',
  )

  // No selected branch means there is no tab/action target; keep the
  // workspace chrome mounted so the right pane still contributes a
  // draggable top region after the global topbar is removed.
  if (!detail.branch) {
    return (
      <Toolbar variant="workspace" className={toolbarClassName} style={{ height: WINDOW_TOPBAR_HEIGHT_PX }}>
        <ToolbarLeadingSlot leading={leading} reserve={trafficLightOffset} />
        <div className="min-w-0 flex-1" />
      </Toolbar>
    )
  }

  const backLabel = t('workspace.back-to-branch-navigator')
  const handleBackToBranchNavigator = () => clearSelectedBranch(repo.id)
  const branchWorkspaceBackAction = compact ? (
    <Tip label={backLabel}>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={handleBackToBranchNavigator}
        aria-label={backLabel}
        title={backLabel}
      >
        <ArrowLeft size={14} />
      </Button>
    </Tip>
  ) : null

  return (
    <Toolbar
      variant="workspace"
      className={toolbarClassName}
      style={{ height: WINDOW_TOPBAR_HEIGHT_PX }}
    >
      <ToolbarLeadingSlot leading={leading} reserve={trafficLightOffset} />
      <div className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {/* Compact UI only: back-to-branch-navigator is the user's escape hatch
            from the branch workspace. It must stay visible even when the tab
            strip below is empty, so it lives at the toolbar level rather than
            inside WorkspacePaneViewStrip's tab chrome. */}
        {compact && branchWorkspaceBackAction}
        {showBranchLevelTabs && (
          <WorkspacePaneViewStrip
            worktreeTerminalKey={terminalWorktreeKey}
            items={workspacePaneTabItems}
            workspacePaneId={workspacePaneId}
            activeTabIdentity={activeTabIdentity}
            responsiveCompact={compact}
            panelActive
            focusRegistry={workspacePaneTabFocusRegistry}
            emptyFocusKey={EMPTY_WORKSPACE_PANE_VIEW_FOCUS_KEY}
            // While a real terminal create is in flight, the tab model
            // contributes a pending terminal tab. Additional creates stay
            // disabled through the New Terminal affordance.
            newTerminalBusy={isInitialSyncInFlight || worktreeSnapshot.pendingCreate}
            onNew={handleNewTerminal}
            onSelect={handleSelectWorkspacePaneTabItem}
            onScrollToBottom={handleScrollToBottom}
            onClose={handleCloseWorkspacePaneView}
            onReorder={handleReorderWorkspacePaneViewStrip}
            activateKeyboardNavigationSelection
          />
        )}
      </div>
    </Toolbar>
  )
}

function ToolbarLeadingSlot({ leading, reserve }: { leading?: ReactNode; reserve: boolean }) {
  if (leading) return <div className="flex h-full min-w-0 shrink-0 items-center gap-1 pr-2">{leading}</div>
  return (
    <div
      data-testid="workspace-toolbar-leading-spacer"
      className={cn(
        'goblin-workspace-toolbar__leading-spacer h-full shrink-0',
        reserve && 'goblin-workspace-toolbar__leading-spacer--reserved',
      )}
      aria-hidden
    />
  )
}
