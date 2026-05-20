import { FolderTree } from 'lucide-react'
import { useT } from '#/renderer/stores/i18n.ts'
import type { RepoState } from '#/renderer/stores/repos.ts'
import { EmptyState } from '#/renderer/components/Layout.tsx'
import { LogList } from '#/renderer/components/LogList.tsx'
import { StatusList } from '#/renderer/components/StatusList.tsx'
import { ListSkeleton } from '#/renderer/components/Skeleton.tsx'
import type { SelectedBranchDetail } from '#/renderer/components/branch-detail/model.ts'

interface Props {
  repo: RepoState
  detail: SelectedBranchDetail
  detailId: string
}

export function BranchDetailContent({ repo, detail, detailId }: Props) {
  const t = useT()
  const { branch, branchLog, selectedStatus } = detail
  if (!branch) return <EmptyState title={t('branches.empty')} />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {repo.detailTab === 'status' && (
        <div
          id={`${detailId}-status-panel`}
          role="tabpanel"
          aria-labelledby={`${detailId}-status-tab`}
          className="flex min-h-0 flex-1 flex-col"
        >
          {branch.worktreePath && repo.statusLoading && !repo.statusLoaded ? (
            <ListSkeleton rows={8} variant="status" />
          ) : branch.worktreePath && !repo.statusLoaded && repo.statusError ? (
            <EmptyState title={t(repo.statusError)} />
          ) : branch.worktreePath ? (
            <StatusList status={selectedStatus} emptyTitleKey="status.cleanTitle" emptyBodyKey="status.cleanBody" />
          ) : (
            <EmptyState
              icon={<FolderTree size={16} />}
              title={t('status.noWorktreeTitle')}
              body={t('status.noWorktreeBody')}
            />
          )}
        </div>
      )}
      {repo.detailTab === 'commits' && (
        <div
          id={`${detailId}-commits-panel`}
          role="tabpanel"
          aria-labelledby={`${detailId}-commits-tab`}
          className="flex min-h-0 flex-1 flex-col"
        >
          {branchLog?.loading && !branchLog.entries.length ? (
            <ListSkeleton variant="log" />
          ) : (
            <LogList
              repoId={repo.id}
              log={branchLog?.entries ?? []}
              branch={branch.name}
              selectedHash={branchLog?.selectedHash ?? null}
            />
          )}
        </div>
      )}
    </div>
  )
}
