import { FolderTree } from 'lucide-react'
import { type ReactNode } from 'react'
import { useT } from '#/web/stores/i18n.ts'
import type { RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { StatusListSkeleton } from '#/web/components/Skeleton.tsx'
import { StatusList } from '#/web/components/StatusList.tsx'
import { BranchStatus } from '#/web/components/branch-detail/BranchStatus.tsx'
import { TerminalSlot } from '#/web/components/terminal/TerminalSlot.tsx'
import type { BranchDetailRepo, SelectedBranchDetailPresentation } from '#/web/components/branch-detail/model.ts'
import { useEffectiveWorkspacePaneView } from '#/web/components/branch-detail/useEffectiveWorkspacePaneView.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { useWorktreeTerminalSnapshot } from '#/web/components/terminal/terminal-session-store.ts'
import {
  activeWorkspacePaneViewIdentity,
  workspacePaneViewButtonId,
  workspacePaneViewIdentity,
} from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { isWorktreeLevelWorkspacePaneView } from '#/web/lib/workspace-pane-view.ts'
import { branchLevelWorkspacePaneViewButtonId } from '#/web/components/branch-detail/workspace-pane-views.ts'
interface Props {
  repo: Pick<BranchDetailRepo, 'id' | 'data' | 'ui'> & {
    data: BranchDetailRepo['data'] & Pick<BranchDetailRepo['data'], 'statusLoaded'>
  }
  detail: SelectedBranchDetailPresentation
  detailId: string
  contentId: string
  layout: RepoWorkspaceLayout
}

interface TabPanelProps {
  id: string
  labelledById: string
  busy?: boolean
  children: ReactNode
}

type BranchDetailBranch = NonNullable<SelectedBranchDetailPresentation['branch']>

// Pure view: the renderable tab is derived from the repos store's
// user-preferred tab and the live terminal session truth via
// `useEffectiveWorkspacePaneView`. The store never re-projects on snapshot
// refresh, branch switch, or session restore; this component is read-only.
export function BranchDetailContent({ repo, detail, detailId, contentId, layout }: Props) {
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
      ? branchLevelWorkspacePaneViewButtonId(detailId, 'status')
      : activeTabIndex >= 0
      ? workspacePaneViewButtonId(detailId, compact ? 0 : activeTabIndex)
      : workspacePaneViewButtonId(detailId, 0)
  const terminalPendingCreate = effectiveTab === 'terminal' && worktreeSnapshot.pendingCreate
  const branchStatusTabActive = effectiveTab === 'status'
  if (!branch)
    return <EmptyState title={t(repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty')} />

  if (!activeTabIdentity && !terminalPendingCreate && !branchStatusTabActive) {
    return (
      <div id={contentId} className="flex min-h-0 flex-1 flex-col">
        <EmptyState title={t('workspace-pane-views.empty')} />
      </div>
    )
  }

  return (
    <div id={contentId} className="flex min-h-0 flex-1 flex-col">
      {effectiveTab === 'status' && (
        <BranchStatusTab
          detailId={detailId}
          labelledById={activeTabLabelledById}
          detail={detail}
          layout={layout}
          busy={detail.loading.pullRequests}
        />
      )}
      {effectiveTab === 'changes' && (
        <BranchChangesTab
          detailId={detailId}
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
        <BranchTerminalTab detailId={detailId} labelledById={activeTabLabelledById} repoId={repo.id} branch={branch} />
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
  detailId,
  labelledById,
  detail,
  layout,
  busy,
}: {
  detailId: string
  labelledById: string
  detail: SelectedBranchDetailPresentation
  layout: RepoWorkspaceLayout
  busy?: boolean
}) {
  return (
    <BranchTabPanel id={`${detailId}-status-panel`} labelledById={labelledById} busy={busy}>
      <ScrollPane>
        <BranchStatus detail={detail} layout={layout} />
      </ScrollPane>
    </BranchTabPanel>
  )
}

function BranchTerminalTab({
  detailId,
  labelledById,
  repoId,
  branch,
}: {
  detailId: string
  labelledById: string
  repoId: string
  branch: BranchDetailBranch
}) {
  if (!branch.worktree?.path) return null
  return (
    <BranchTabPanel id={`${detailId}-terminal-panel`} labelledById={labelledById}>
      <TerminalSlot repoRoot={repoId} branch={branch.name} worktreePath={branch.worktree?.path} />
    </BranchTabPanel>
  )
}

function BranchChangesTab({
  detailId,
  labelledById,
  repo,
  branch,
  selectedStatus,
  statusLoading,
  statusError,
  statusStale,
}: {
  detailId: string
  labelledById: string
  repo: Props['repo']
  branch: BranchDetailBranch
  selectedStatus: SelectedBranchDetailPresentation['selectedStatus']
  statusLoading: boolean
  statusError: string | null
  statusStale: boolean
}) {
  const t = useT()
  const totalEntries = selectedStatus.reduce((n, wt) => n + wt.entries.length, 0)

  return (
    <BranchTabPanel id={`${detailId}-changes-panel`} labelledById={labelledById} busy={statusLoading}>
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
