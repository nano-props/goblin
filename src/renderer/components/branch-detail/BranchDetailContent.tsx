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
import { Button } from '#/renderer/components/ui/button.tsx'
import { TerminalSlot } from '#/renderer/components/terminal/TerminalSlot.tsx'
import type { SelectedBranchDetailPresentation } from '#/renderer/components/branch-detail/model.ts'
import { isShortcutBlockingLayerOpen } from '#/renderer/lib/layers.ts'
import { detailTabForWorktree } from '#/renderer/lib/detail-tabs.ts'

interface Props {
  repo: RepoState
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

export function BranchDetailContent({ repo, detail, detailId, contentId, layout }: Props) {
  const t = useT()
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const { branch } = detail
  useEffect(() => {
    if (!branch) return
    const nextTab = detailTabForWorktree(repo.ui.detailTab, !!branch.worktree?.path)
    if (nextTab !== repo.ui.detailTab) setDetailTab(repo.id, nextTab)
  }, [branch, repo.id, repo.ui.detailTab, setDetailTab])
  if (!branch)
    return <EmptyState title={t(repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty')} />

  return (
    <div id={contentId} className="flex min-h-0 flex-1 flex-col">
      {repo.ui.detailTab === 'status' && (
        <BranchStatusTab detailId={detailId} detail={detail} layout={layout} busy={detail.loading.pullRequests} />
      )}
      {repo.ui.detailTab === 'changes' && (
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
      {repo.ui.detailTab === 'commits' && (
        <BranchCommitsTab
          detailId={detailId}
          repoId={repo.id}
          branch={branch}
          branchLog={detail.branchLog}
          commitDetail={repo.ui.commitDetail}
          busy={detail.loading.commits}
          initialLoading={detail.loading.logInitial}
          appendLoading={detail.loading.logAppend}
        />
      )}
      {repo.ui.detailTab === 'terminal' && branch.worktree?.path && (
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
  repo: RepoState
  branch: BranchDetailBranch
  selectedStatus: SelectedBranchDetailPresentation['selectedStatus']
  statusLoading: boolean
  statusError: string | null
  statusStale: boolean
}) {
  const t = useT()
  // Keep this tab-level count separate from StatusList's empty-state check: the tab decides the scroll boundary.
  const totalEntries = selectedStatus.reduce((n, wt) => n + wt.entries.length, 0)

  return (
    <BranchTabPanel detailId={detailId} tabId="changes" busy={statusLoading}>
      {branch.worktree?.path && statusLoading && !repo.data.statusLoaded ? (
        <ListSkeleton rows={8} variant="status" />
      ) : branch.worktree?.path && !repo.data.statusLoaded && statusError ? (
        <EmptyState title={t(statusError)} />
      ) : branch.worktree?.path ? (
        totalEntries > 0 ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {statusStale && statusError && <StaleStatusNotice message={statusError} />}
            <ScrollPane>
              <StatusList status={selectedStatus} emptyTitleKey="status.clean-title" emptyBodyKey="status.clean-body" />
            </ScrollPane>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {statusStale && statusError && <StaleStatusNotice message={statusError} />}
            <StatusList status={selectedStatus} emptyTitleKey="status.clean-title" emptyBodyKey="status.clean-body" />
          </div>
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

function StaleStatusNotice({ message }: { message: string }) {
  const t = useT()
  return (
    <div className="border-b border-warning-border bg-warning-surface px-4 py-2 text-xs text-warning">
      <span className="font-medium">{t('status.stale-title')}</span>
      <span className="text-muted-foreground"> — {t(message)}</span>
    </div>
  )
}

function BranchCommitsTab({
  detailId,
  repoId,
  branch,
  branchLog,
  commitDetail,
  busy,
  initialLoading,
  appendLoading,
}: {
  detailId: string
  repoId: string
  branch: BranchDetailBranch
  branchLog: SelectedBranchDetailPresentation['branchLog']
  commitDetail: RepoState['ui']['commitDetail']
  busy: boolean
  initialLoading: boolean
  appendLoading: boolean
}) {
  return (
    <BranchTabPanel detailId={detailId} tabId="commits" busy={busy}>
      {commitDetail.phase === 'open' ? (
        <CommitDetail repoId={repoId} detail={commitDetail.detail} />
      ) : commitDetail.phase === 'opening' ? (
        <OpeningCommitDetail repoId={repoId} />
      ) : initialLoading ? (
        <ListSkeleton variant="log" />
      ) : branchLog?.entries.length ? (
        <ScrollPane>
          <LogList
            repoId={repoId}
            log={branchLog.entries}
            branch={branch.name}
            selectedHash={branchLog.selectedHash ?? null}
            hasMore={branchLog.hasMore}
            loading={appendLoading}
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
  if (!branch.worktree?.path) return null
  return (
    <BranchTabPanel detailId={detailId} tabId="terminal">
      <TerminalSlot repoRoot={repoId} branch={branch.name} worktreePath={branch.worktree?.path} />
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
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => closeCommit(repoId)}
          className="mt-0.5 shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          aria-label={t('error.back')}
          title={t('error.back')}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1 space-y-2 py-0.5">
          <span className="block h-3 w-24 animate-pulse rounded bg-accent" />
          <span className="block h-3 w-2/3 animate-pulse rounded bg-accent" />
        </div>
      </div>
      <ListSkeleton rows={8} variant="log" />
    </div>
  )
}
