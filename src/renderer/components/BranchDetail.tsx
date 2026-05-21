import { useId } from 'react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { getSelectedBranchDetail } from '#/renderer/components/branch-detail/model.ts'
import { BranchDetailToolbar } from '#/renderer/components/branch-detail/BranchDetailToolbar.tsx'
import { BranchDetailContent } from '#/renderer/components/branch-detail/BranchDetailContent.tsx'

interface Props {
  repoId: string
  collapsed?: boolean
}

export function BranchDetail({ repoId, collapsed = false }: Props) {
  const detailId = useId()
  const repo = useReposStore((s) => s.repos[repoId])
  if (!repo) return null

  const detail = getSelectedBranchDetail(repo)
  const contentId = `${detailId}-content`

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <BranchDetailToolbar
        repo={repo}
        detail={detail}
        detailId={detailId}
        contentId={contentId}
        collapsed={collapsed}
      />
      {!collapsed && <BranchDetailContent repo={repo} detail={detail} detailId={detailId} contentId={contentId} />}
    </section>
  )
}
