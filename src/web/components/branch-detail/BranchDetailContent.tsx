import { FolderTree } from 'lucide-react'
import { type ReactNode } from 'react'
import { useT } from '#/web/stores/i18n.ts'
import type { DetailTab, RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { StatusListSkeleton } from '#/web/components/Skeleton.tsx'
import { StatusList } from '#/web/components/StatusList.tsx'
import { BranchStatus } from '#/web/components/branch-detail/BranchStatus.tsx'
import { TerminalSlot } from '#/web/components/terminal/TerminalSlot.tsx'
import type { BranchDetailRepo, SelectedBranchDetailPresentation } from '#/web/components/branch-detail/model.ts'
import { useEffectiveDetailTab } from '#/web/components/branch-detail/useEffectiveDetailTab.ts'
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
  detailId: string
  tabId: DetailTab
  busy?: boolean
  children: ReactNode
}

type BranchDetailBranch = NonNullable<SelectedBranchDetailPresentation['branch']>

// Pure view: the renderable tab is derived from the repos store's
// user-preferred tab and the live terminal session truth via
// `useEffectiveDetailTab`. The store never re-projects on snapshot
// refresh, branch switch, or session restore; this component is read-only.
export function BranchDetailContent({ repo, detail, detailId, contentId, layout }: Props) {
  const t = useT()
  const effectiveTab = useEffectiveDetailTab(repo)
  const { branch } = detail
  if (!branch)
    return <EmptyState title={t(repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty')} />

  return (
    <div id={contentId} className="flex min-h-0 flex-1 flex-col">
      {effectiveTab === 'status' && (
        <BranchStatusTab detailId={detailId} detail={detail} layout={layout} busy={detail.loading.pullRequests} />
      )}
      {effectiveTab === 'changes' && (
        <BranchChangesTab
          detailId={detailId}
          repo={repo}
          branch={branch}
          selectedStatus={detail.selectedStatus}
          statusLoading={detail.loading.status}
          statusError={detail.errors.status}
          statusStale={detail.stale.status}
        />
      )}
      {effectiveTab === 'terminal' && branch.worktree?.path && (
        <BranchTerminalTab detailId={detailId} repoId={repo.id} branch={branch} />
      )}
    </div>
  )
}

function BranchTabPanel({ detailId, tabId, busy = false, children }: TabPanelProps) {
  return (
    <div
      id={`${detailId}-${tabId}-panel`}
      role="tabpanel"
      aria-busy={busy || undefined}
      aria-labelledby={`${detailId}-${tabId}-tab`}
      className="flex min-h-0 flex-1 flex-col"
    >
      {children}
    </div>
  )
}

function BranchStatusTab({
  detailId,
  detail,
  layout,
  busy,
}: {
  detailId: string
  detail: SelectedBranchDetailPresentation
  layout: RepoWorkspaceLayout
  busy?: boolean
}) {
  return (
    <BranchTabPanel detailId={detailId} tabId="status" busy={busy}>
      <ScrollPane>
        <BranchStatus detail={detail} layout={layout} />
      </ScrollPane>
    </BranchTabPanel>
  )
}

function BranchTerminalTab({
  detailId,
  repoId,
  branch,
}: {
  detailId: string
  repoId: string
  branch: BranchDetailBranch
}) {
  if (!branch.worktree?.path) return null
  return (
    <BranchTabPanel detailId={detailId} tabId="terminal">
      <TerminalSlot repoRoot={repoId} branch={branch.name} worktreePath={branch.worktree?.path} />
    </BranchTabPanel>
  )
}

function BranchChangesTab({
  detailId,
  repo,
  branch,
  selectedStatus,
  statusLoading,
  statusError,
  statusStale,
}: {
  detailId: string
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
    <BranchTabPanel detailId={detailId} tabId="changes" busy={statusLoading}>
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
