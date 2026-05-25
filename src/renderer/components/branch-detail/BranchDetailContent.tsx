import { ArrowLeft, FolderTree } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useT } from '#/renderer/stores/i18n.ts'
import type { DetailTab, RepoState, RepoWorkspaceLayout } from '#/renderer/stores/repos/types.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { EmptyState, ScrollPane } from '#/renderer/components/Layout.tsx'
import { CommitDetail } from '#/renderer/components/CommitDetail.tsx'
import { LogList } from '#/renderer/components/LogList.tsx'
import { StatusList } from '#/renderer/components/StatusList.tsx'
import { ListSkeleton } from '#/renderer/components/Skeleton.tsx'
import { BranchStatus } from '#/renderer/components/branch-detail/BranchStatus.tsx'
import { TerminalSlot } from '#/renderer/components/terminal/TerminalSlot.tsx'
import type { SelectedBranchDetail } from '#/renderer/components/branch-detail/model.ts'
import { operationBusy } from '#/renderer/stores/repos/operations.ts'
import { isShortcutBlockingLayerOpen } from '#/renderer/lib/layers.ts'
import { detailTabForWorktree } from '#/renderer/lib/detail-tabs.ts'

interface Props {
  repo: RepoState
  detail: SelectedBranchDetail
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

type BranchDetailBranch = NonNullable<SelectedBranchDetail['branch']>

export function BranchDetailContent({ repo, detail, detailId, contentId, layout }: Props) {
  const t = useT()
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const { branch } = detail
  useEffect(() => {
    if (!branch) return
    const nextTab = detailTabForWorktree(repo.ui.detailTab, !!branch.worktreePath)
    if (nextTab !== repo.ui.detailTab) setDetailTab(repo.id, nextTab)
  }, [branch, repo.id, repo.ui.detailTab, setDetailTab])
  if (!branch)
    return <EmptyState title={t(repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty')} />

  const branchLogOperation = repo.ops.logsByBranch[branch.name]
  const commitsBusy =
    repo.ui.commitDetail.phase === 'opening' ||
    detail.branchLog?.loading === true ||
    (branchLogOperation ? operationBusy(branchLogOperation) : false)

  return (
    <div id={contentId} className="flex min-h-0 flex-1 flex-col">
      {repo.ui.detailTab === 'status' && (
        <BranchStatusTab
          detailId={detailId}
          detail={detail}
          layout={layout}
          busy={operationBusy(repo.ops.pullRequests)}
        />
      )}
      {repo.ui.detailTab === 'changes' && (
        <BranchChangesTab detailId={detailId} repo={repo} branch={branch} selectedStatus={detail.selectedStatus} />
      )}
      {repo.ui.detailTab === 'commits' && (
        <BranchCommitsTab
          detailId={detailId}
          repoId={repo.id}
          branch={branch}
          branchLog={detail.branchLog}
          commitDetail={repo.ui.commitDetail}
          busy={commitsBusy}
        />
      )}
      {repo.ui.detailTab === 'terminal' && branch.worktreePath && (
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
  detail: SelectedBranchDetail
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

function BranchChangesTab({
  detailId,
  repo,
  branch,
  selectedStatus,
}: {
  detailId: string
  repo: RepoState
  branch: BranchDetailBranch
  selectedStatus: SelectedBranchDetail['selectedStatus']
}) {
  const t = useT()
  const statusLoading = operationBusy(repo.ops.status)
  const statusError = repo.ops.status.error
  // Keep this tab-level count separate from StatusList's empty-state check: the tab decides the scroll boundary.
  const totalEntries = selectedStatus.reduce((n, wt) => n + wt.entries.length, 0)

  return (
    <BranchTabPanel detailId={detailId} tabId="changes" busy={statusLoading}>
      {branch.worktreePath && statusLoading && !repo.data.statusLoaded ? (
        <ListSkeleton rows={8} variant="status" />
      ) : branch.worktreePath && !repo.data.statusLoaded && statusError ? (
        <EmptyState title={t(statusError)} />
      ) : branch.worktreePath ? (
        totalEntries > 0 ? (
          <ScrollPane>
            <StatusList status={selectedStatus} emptyTitleKey="status.clean-title" emptyBodyKey="status.clean-body" />
          </ScrollPane>
        ) : (
          <StatusList status={selectedStatus} emptyTitleKey="status.clean-title" emptyBodyKey="status.clean-body" />
        )
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

function BranchCommitsTab({
  detailId,
  repoId,
  branch,
  branchLog,
  commitDetail,
  busy,
}: {
  detailId: string
  repoId: string
  branch: BranchDetailBranch
  branchLog: SelectedBranchDetail['branchLog']
  commitDetail: RepoState['ui']['commitDetail']
  busy: boolean
}) {
  return (
    <BranchTabPanel detailId={detailId} tabId="commits" busy={busy}>
      {commitDetail.phase === 'open' ? (
        <CommitDetail repoId={repoId} detail={commitDetail.detail} />
      ) : commitDetail.phase === 'opening' ? (
        <OpeningCommitDetail repoId={repoId} />
      ) : branchLog?.loading && !branchLog.entries.length ? (
        <ListSkeleton variant="log" />
      ) : branchLog?.entries.length ? (
        <ScrollPane>
          <LogList
            repoId={repoId}
            log={branchLog.entries}
            branch={branch.name}
            selectedHash={branchLog.selectedHash ?? null}
            hasMore={branchLog.hasMore}
            loading={branchLog.loading}
          />
        </ScrollPane>
      ) : (
        <LogList repoId={repoId} log={[]} branch={branch.name} selectedHash={null} />
      )}
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
  if (!branch.worktreePath) return null
  return (
    <BranchTabPanel detailId={detailId} tabId="terminal">
      <TerminalSlot repoRoot={repoId} branch={branch.name} worktreePath={branch.worktreePath} />
    </BranchTabPanel>
  )
}

function OpeningCommitDetail({ repoId }: { repoId: string }) {
  const t = useT()
  const closeCommit = useReposStore((s) => s.closeCommit)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isShortcutBlockingLayerOpen()) return
      closeCommit(repoId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repoId, closeCommit])

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
      <div className="flex items-start gap-3 border-b border-separator bg-muted px-4 py-3">
        <button
          type="button"
          onClick={() => closeCommit(repoId)}
          className="mt-0.5 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground transition-colors duration-100"
          aria-label={t('error.back')}
          title={t('error.back')}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1 space-y-2 py-0.5">
          <span className="block h-3 w-24 animate-pulse rounded bg-accent" />
          <span className="block h-3 w-2/3 animate-pulse rounded bg-accent" />
        </div>
      </div>
      <ListSkeleton rows={8} variant="log" />
    </div>
  )
}
