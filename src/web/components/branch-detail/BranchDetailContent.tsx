import { useEffect, type ReactNode } from 'react'
import { useT } from '#/web/stores/i18n.ts'
import type { DetailTab, RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { BranchStatus } from '#/web/components/branch-detail/BranchStatus.tsx'
import { TerminalSlot } from '#/web/components/terminal/TerminalSlot.tsx'
import type { BranchDetailRepo, SelectedBranchDetailPresentation } from '#/web/components/branch-detail/model.ts'
import { detailTabForWorktree } from '#/web/lib/detail-tabs.ts'
interface Props {
  repo: Pick<BranchDetailRepo, 'id' | 'data' | 'ui'>
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
