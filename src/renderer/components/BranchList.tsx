// Persistent branch list. Each row shows branch name, lightweight
// scan signals, and the head commit subject, author, and relative date. The
// selected row scrolls into view automatically when the user moves with
// j/k or arrows so a long branch list doesn't strand the cursor offscreen.
//
// Worktree branches use a folder-tree glyph and a compact chip beside the
// name. We avoid tinting the whole row so selection, hover, and status
// semantics don't compete for background colour.

import { useCallback, useEffect, useRef } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useI18nStore, useT } from '#/renderer/stores/i18n.ts'
import { visibleBranches } from '#/renderer/stores/repos/branch-view-mode.ts'
import { BranchRow } from '#/renderer/components/branch-list/BranchRow.tsx'
import { EmptyState } from '#/renderer/components/Layout.tsx'
import { useGhosttyInstalled } from '#/renderer/hooks/useGhosttyInstalled.ts'
import { useVSCodeInstalled } from '#/renderer/hooks/useVSCodeInstalled.ts'

interface Props {
  repoId: string
}

export function BranchList({ repoId }: Props) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const selectBranch = useReposStore((s) => s.selectBranch)
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const setDetailCollapsed = useReposStore((s) => s.setDetailCollapsed)
  const selectedRef = useRef<HTMLLIElement | null>(null)
  const ghosttyInstalled = useGhosttyInstalled()
  const vscodeInstalled = useVSCodeInstalled()
  const handleSelectBranch = useCallback(
    (branch: string) => {
      selectBranch(repoId, branch)
    },
    [repoId, selectBranch],
  )
  const handleOpenBranchStatus = useCallback(
    (branch: string) => {
      handleSelectBranch(branch)
      setDetailTab(repoId, 'status')
      setDetailCollapsed(false)
    },
    [repoId, handleSelectBranch, setDetailCollapsed, setDetailTab],
  )
  const { repo, branches, selected, current } = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      return {
        repo,
        branches: repo ? visibleBranches(repo) : [],
        branchCount: repo?.data.branches.length ?? 0,
        selected: repo?.ui.selectedBranch ?? null,
        current: repo?.data.currentBranch ?? '',
      }
    },
    (a, b) =>
      a.repo === b.repo ||
      (!!a.repo &&
        !!b.repo &&
        a.repo.id === b.repo.id &&
        a.repo.instanceToken === b.repo.instanceToken &&
        a.repo.data.branches === b.repo.data.branches &&
        a.repo.ui.branchViewMode === b.repo.ui.branchViewMode &&
        a.repo.data.status === b.repo.data.status &&
        a.branchCount === b.branchCount &&
        a.selected === b.selected &&
        a.current === b.current),
  )

  // Keep the selected row in view as the user navigates with j/k.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!repo) return null

  if (branches.length === 0) {
    return <EmptyState title={t(repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty')} />
  }

  return (
    <ul className="overflow-y-auto scroll-thin flex-1 divide-y divide-separator">
      {branches.map((branch) => {
        return (
          <BranchRow
            key={branch.name}
            repo={repo}
            branch={branch}
            selected={selected}
            current={current}
            lang={lang}
            onSelectBranch={handleSelectBranch}
            onOpenBranchStatus={handleOpenBranchStatus}
            selectedRef={selectedRef}
            ghosttyInstalled={ghosttyInstalled}
            vscodeInstalled={vscodeInstalled}
          />
        )
      })}
    </ul>
  )
}
