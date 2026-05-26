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
import { ScrollArea } from '#/renderer/components/ui/scroll-area.tsx'

interface Props {
  repoId: string
  showActions?: boolean
  variant?: 'list' | 'selected-strip'
}

export function BranchList({ repoId, showActions = true, variant = 'list' }: Props) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const selectBranch = useReposStore((s) => s.selectBranch)
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const setDetailCollapsed = useReposStore((s) => s.setDetailCollapsed)
  const selectedRef = useRef<HTMLLIElement | null>(null)
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
      const branchSearchQuery = s.branchSearchQueries[repoId] ?? ''
      return {
        repo,
        branches: repo
          ? visibleBranches({
              branches: repo.data.branches,
              viewMode: repo.ui.branchViewMode,
              searchQuery: branchSearchQuery,
            })
          : [],
        branchCount: repo?.data.branches.length ?? 0,
        branchSearchQuery,
        selected: repo?.ui.selectedBranch ?? null,
        current: repo?.data.currentBranch ?? '',
      }
    },
    (a, b) =>
      a.repo === b.repo
        ? a.branchSearchQuery === b.branchSearchQuery
        : !!a.repo &&
            !!b.repo &&
            a.repo.id === b.repo.id &&
            a.repo.instanceToken === b.repo.instanceToken &&
            a.repo.data.branches === b.repo.data.branches &&
            a.repo.ui.branchViewMode === b.repo.ui.branchViewMode &&
            a.branchSearchQuery === b.branchSearchQuery &&
            a.repo.data.status === b.repo.data.status &&
            a.repo.resources.branchAction === b.repo.resources.branchAction &&
            a.branchCount === b.branchCount &&
            a.selected === b.selected &&
            a.current === b.current,
  )

  // Keep the selected row in view as the user navigates with j/k.
  useEffect(() => {
    const selectedEl = selectedRef.current
    if (selectedEl && variant === 'list') selectedEl.scrollIntoView({ block: 'nearest' })
  }, [selected, variant])

  if (!repo) return null

  const selectedBranch = selected
    ? (branches.find((branch) => branch.name === selected) ??
      repo.data.branches.find((branch) => branch.name === selected))
    : null
  const renderedBranches = variant === 'selected-strip' ? (selectedBranch ? [selectedBranch] : []) : branches

  if (renderedBranches.length === 0) {
    return <EmptyState title={t(repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty')} />
  }

  const list = (
    <ul className="divide-y divide-separator">
      {renderedBranches.map((branch) => {
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
            showActions={showActions}
          />
        )
      })}
    </ul>
  )

  if (variant === 'selected-strip')
    return (
      <div className="shrink-0 overflow-hidden" role="region" aria-label={t('branches.selected')} aria-live="polite">
        {list}
      </div>
    )

  return <ScrollArea className="min-h-0 flex-1">{list}</ScrollArea>
}
