import { FolderTree } from 'lucide-react'
import { type ReactNode } from 'react'
import { useT } from '#/web/stores/i18n.ts'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { StatusListSkeleton } from '#/web/components/Skeleton.tsx'
import { StatusList } from '#/web/components/StatusList.tsx'
import { BranchStatus } from '#/web/components/branch-workspace/BranchStatus.tsx'
import { TerminalSlot } from '#/web/components/terminal/TerminalSlot.tsx'
import type {
  BranchWorkspaceRepo,
  SelectedBranchWorkspacePresentation,
} from '#/web/components/branch-workspace/model.ts'
import { useEffectiveWorkspacePaneView } from '#/web/components/branch-workspace/useEffectiveWorkspacePaneView.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { useWorktreeTerminalSnapshot } from '#/web/components/terminal/terminal-session-store.ts'
import {
  activeWorkspacePaneViewIdentity,
  workspacePaneViewButtonId,
  workspacePaneViewIdentity,
} from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { isWorktreeLevelWorkspacePaneView } from '#/web/lib/workspace-pane-view.ts'
import { branchLevelWorkspacePaneViewButtonId } from '#/web/components/branch-workspace/workspace-pane-views.ts'
interface Props {
  repo: Pick<BranchWorkspaceRepo, 'id' | 'data' | 'ui'> & {
    data: BranchWorkspaceRepo['data'] & Pick<BranchWorkspaceRepo['data'], 'statusLoaded'>
  }
  detail: SelectedBranchWorkspacePresentation
  workspacePaneId: string
}

interface TabPanelProps {
  id: string
  labelledById: string
  busy?: boolean
  children: ReactNode
}

type BranchWorkspaceBranch = NonNullable<SelectedBranchWorkspacePresentation['branch']>

// Pure view: the renderable tab is derived from the repos store's
// user-preferred tab and the live terminal session truth via
// `useEffectiveWorkspacePaneView`. The store never re-projects on snapshot
// refresh, branch switch, or session restore; this component is read-only.
export function BranchWorkspaceContent({ repo, detail, workspacePaneId }: Props) {
  const t = useT()
  const compact = useIsCompactUi()
  const effectiveTab = useEffectiveWorkspacePaneView(repo)
  const { branch } = detail
  const terminalWorktreeKey = branch?.worktree?.path ? worktreeTerminalKey(repo.id, branch.worktree.path) : null
  const worktreeSnapshot = useWorktreeTerminalSnapshot(terminalWorktreeKey)
  const worktreeWorkspacePaneViews = worktreeSnapshot.workspacePaneViews.filter((tab) =>
    isWorktreeLevelWorkspacePaneView(tab.type),
  )
  const activeTabIdentity = activeWorkspacePaneViewIdentity(worktreeWorkspacePaneViews, effectiveTab)
  const activeTabIndex = activeTabIdentity
    ? worktreeWorkspacePaneViews.findIndex((tab) => workspacePaneViewIdentity(tab) === activeTabIdentity)
    : -1
  const activeTabLabelledById =
    effectiveTab === 'status'
      ? branchLevelWorkspacePaneViewButtonId(workspacePaneId, 'status')
      : activeTabIndex >= 0
        ? workspacePaneViewButtonId(workspacePaneId, compact ? 0 : activeTabIndex)
        : workspacePaneViewButtonId(workspacePaneId, 0)
  const terminalPendingCreate = effectiveTab === 'terminal' && worktreeSnapshot.pendingCreate
  const branchStatusTabActive =
    effectiveTab === 'status' && repo.ui.openBranchWorkspacePaneViews.includes('status')
  if (!branch)
    return <EmptyState title={t(repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty')} />

  if (!activeTabIdentity && !terminalPendingCreate && !branchStatusTabActive) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EmptyState title={t('workspace-pane-views.empty')} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {effectiveTab === 'status' && (
        <BranchStatusTab
          workspacePaneId={workspacePaneId}
          labelledById={activeTabLabelledById}
          detail={detail}
          busy={detail.loading.pullRequests}
        />
      )}
      {effectiveTab === 'changes' && (
        <BranchChangesTab
          workspacePaneId={workspacePaneId}
          labelledById={activeTabLabelledById}
          repo={repo}
          branch={branch}
          selectedStatus={detail.selectedStatus}
          statusLoading={detail.loading.status}
          statusError={detail.errors.status}
          statusStale={detail.stale.status}
        />
      )}
      {effectiveTab === 'terminal' && branch.worktree?.path && (
        <BranchTerminalTab
          workspacePaneId={workspacePaneId}
          labelledById={activeTabLabelledById}
          repoId={repo.id}
          branch={branch}
        />
      )}
    </div>
  )
}

function BranchTabPanel({ id, labelledById, busy = false, children }: TabPanelProps) {
  return (
    <div
      id={id}
      role="tabpanel"
      aria-busy={busy || undefined}
      aria-labelledby={labelledById}
      className="flex min-h-0 flex-1 flex-col"
    >
      {children}
    </div>
  )
}

function BranchStatusTab({
  workspacePaneId,
  labelledById,
  detail,
  busy,
}: {
  workspacePaneId: string
  labelledById: string
  detail: SelectedBranchWorkspacePresentation
  busy?: boolean
}) {
  return (
    <BranchTabPanel id={`${workspacePaneId}-status-panel`} labelledById={labelledById} busy={busy}>
      <ScrollPane>
        <BranchStatus detail={detail} />
      </ScrollPane>
    </BranchTabPanel>
  )
}

function BranchTerminalTab({
  workspacePaneId,
  labelledById,
  repoId,
  branch,
}: {
  workspacePaneId: string
  labelledById: string
  repoId: string
  branch: BranchWorkspaceBranch
}) {
  if (!branch.worktree?.path) return null
  return (
    <BranchTabPanel id={`${workspacePaneId}-terminal-panel`} labelledById={labelledById}>
      <TerminalSlot repoRoot={repoId} branch={branch.name} worktreePath={branch.worktree?.path} />
    </BranchTabPanel>
  )
}

function BranchChangesTab({
  workspacePaneId,
  labelledById,
  repo,
  branch,
  selectedStatus,
  statusLoading,
  statusError,
  statusStale,
}: {
  workspacePaneId: string
  labelledById: string
  repo: Props['repo']
  branch: BranchWorkspaceBranch
  selectedStatus: SelectedBranchWorkspacePresentation['selectedStatus']
  statusLoading: boolean
  statusError: string | null
  statusStale: boolean
}) {
  const t = useT()
  const totalEntries = selectedStatus.reduce((n, wt) => n + wt.entries.length, 0)

  return (
    <BranchTabPanel id={`${workspacePaneId}-changes-panel`} labelledById={labelledById} busy={statusLoading}>
      {branch.worktree?.path && statusLoading && !repo.data.statusLoaded ? (
        <StatusListSkeleton rows={8} />
      ) : branch.worktree?.path && !repo.data.statusLoaded && statusError ? (
        <EmptyState title={t(statusError)} />
      ) : branch.worktree?.path ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {statusStale && statusError && <StaleStatusNotice message={statusError} />}
          {totalEntries > 0 ? (
            <ScrollPane>
              <StatusList status={selectedStatus} />
            </ScrollPane>
          ) : (
            <StatusList status={selectedStatus} />
          )}
        </div>
      ) : (
        <EmptyState
          icon={<FolderTree size={16} />}
          title={t('status.no-worktree-title')}
          body={t('status.no-worktree-body')}
        />
      )}
    </BranchTabPanel>
  )
}

function StaleStatusNotice({ message }: { message: string }) {
  const t = useT()
  return (
    <div className="border-b border-warning-border bg-warning-surface px-4 py-2 text-xs text-warning">
      <span className="font-medium">{t('status.stale-title')}</span>
      <span className="text-muted-foreground"> — {t(message)}</span>
    </div>
  )
}
