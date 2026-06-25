import { useT } from '#/web/stores/i18n.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import type {
  BranchWorkspaceRepo,
  SelectedBranchWorkspacePresentation,
} from '#/web/components/branch-workspace/model.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-slot-keys.ts'
import {
  useTerminalRepoSyncReady,
  useWorktreeTerminalSnapshot,
} from '#/web/components/terminal/terminal-slot-store.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { workspacePaneTabOrderForBranch } from '#/web/stores/repos/workspace-pane-tabs.ts'
import {
  createBranchWorkspacePaneTabModel,
  type BranchWorkspacePaneTab,
  type BranchWorkspacePaneSelection,
} from '#/web/components/branch-workspace/workspace-pane-tab-model.ts'
import { preferredWorkspacePaneViewForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import {
  terminalWorkspacePaneTabProvider,
  workspacePaneStaticTabProvider,
  type WorkspacePanePanelLabel,
} from '#/web/workspace-pane/workspace-pane-tab-providers.ts'
import { renderBranchWorkspacePanePanel } from '#/web/components/branch-workspace/workspace-pane-panels.tsx'

interface Props {
  repo: Pick<BranchWorkspaceRepo, 'id' | 'data' | 'ui'> & {
    data: BranchWorkspaceRepo['data'] & Pick<BranchWorkspaceRepo['data'], 'statusLoaded'>
  }
  detail: SelectedBranchWorkspacePresentation
  workspacePaneId: string
}

// Pure view: the workspace pane body is derived from the repos store's
// branch-scoped preferred view and the live terminal session truth. The store
// never re-projects on snapshot refresh, branch switch, or session restore.
// The tab model keeps the body render target separate from the active
// materialized tab.
export function BranchWorkspaceContent({ repo, detail, workspacePaneId }: Props) {
  const t = useT()
  const compact = useIsCompactUi()
  const { branch } = detail
  const terminalWorktreeKey = branch?.worktree?.path ? worktreeTerminalKey(repo.id, branch.worktree.path) : null
  const worktreeSnapshot = useWorktreeTerminalSnapshot(terminalWorktreeKey)
  const terminalSyncReady = useTerminalRepoSyncReady(repo.id)
  const workspacePaneTabOrder = workspacePaneTabOrderForBranch(repo.ui, branch?.name)
  const workspacePaneTabModel = createBranchWorkspacePaneTabModel({
    repoId: repo.id,
    branchName: branch?.name ?? null,
    worktreePath: branch?.worktree?.path ?? null,
    preferredView: preferredWorkspacePaneViewForBranch(repo.ui, branch?.name),
    tabOrder: workspacePaneTabOrder,
    runtimeTerminalViews: worktreeSnapshot.slots,
    terminalSessionCount: worktreeSnapshot.count,
    terminalCreatePending: worktreeSnapshot.pendingCreate,
    terminalSyncReady,
    lastClosedTabContext: branch ? (repo.ui.lastClosedTabContextByBranch[branch.name] ?? null) : null,
  })
  const selection = workspacePaneTabModel.selection
  const renderedView = selection?.view ?? null
  const panelLabel = workspacePanePanelLabel({
    selection,
    tabs: workspacePaneTabModel.tabs,
    workspacePaneId,
    compact,
    t,
    terminalSyncReady,
    terminalCreatePending: worktreeSnapshot.pendingCreate,
  })
  const noBranchTitleKey = repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty'
  if (!branch) return <EmptyState title={t(noBranchTitleKey)} />

  if (!selection) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EmptyState title={t('workspace-pane-views.empty')} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {renderedView
        ? renderBranchWorkspacePanePanel({
            type: renderedView,
            repo,
            detail,
            workspacePaneId,
            panelLabel,
            terminalSyncReady,
          })
        : null}
    </div>
  )
}

function workspacePanePanelLabel(input: {
  selection: BranchWorkspacePaneSelection | null
  tabs: readonly BranchWorkspacePaneTab[]
  workspacePaneId: string
  compact: boolean
  t: (key: string, params?: Record<string, string | number>) => string
  terminalSyncReady: boolean
  terminalCreatePending: boolean
}): WorkspacePanePanelLabel {
  const tab = input.selection?.kind === 'materialized-tab' ? input.selection.tab : null
  if (tab?.kind === 'terminal') {
    const terminalTabs = input.tabs.filter((candidate) => candidate.kind === 'terminal')
    const index = terminalTabs.findIndex((candidate) => candidate.identity === tab.identity)
    return {
      labelledById: terminalWorkspacePaneTabProvider.buttonId(
        input.workspacePaneId,
        input.compact ? 0 : Math.max(0, index),
      ),
    }
  }
  if (tab?.kind === 'static') {
    return { labelledById: workspacePaneStaticTabProvider(tab.type).buttonId(input.workspacePaneId) }
  }
  const pendingTab = input.tabs.find((candidate) => candidate.kind === 'pending')
  if (pendingTab) {
    return { labelledById: `${input.workspacePaneId}-${pendingTab.type}-pending-tab` }
  }
  return {
    label: terminalWorkspacePaneTabProvider.pendingLabel({
      t: input.t,
      terminalCreatePending: input.terminalCreatePending,
      terminalSyncReady: input.terminalSyncReady,
    }),
  }
}
