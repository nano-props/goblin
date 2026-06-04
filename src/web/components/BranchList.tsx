// Persistent branch list. Each row shows branch name, lightweight
// scan signals, and the head commit subject, author, and relative date. The
// selected row scrolls into view automatically when the user moves with
// j/k or arrows so a long branch list doesn't strand the cursor offscreen.
//
// Worktree branches use a folder-tree glyph and a compact chip beside the
// name. We avoid tinting the whole row so selection, hover, and status
// semantics don't compete for background colour.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import { visibleBranches } from '#/web/stores/repos/branch-view-mode.ts'
import { BranchRow } from '#/web/components/branch-list/BranchRow.tsx'
import { EmptyState } from '#/web/components/Layout.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'

interface Props {
  repoId: string
  showActions?: boolean
  variant?: 'list' | 'selected-strip'
}

type OpenActionMenu = { repoId: string; branch: string }

export function BranchList({ repoId, showActions = true, variant = 'list' }: Props) {
  const t = useT()
  const selectBranch = useReposStore((s) => s.selectBranch)
  const setDetailCollapsed = useReposStore((s) => s.setDetailCollapsed)
  const navigation = useMainWindowNavigation()
  const selectedRef = useRef<HTMLLIElement | null>(null)
  const [openActionMenu, setOpenActionMenu] = useState<OpenActionMenu | null>(null)
  const handleSelectBranch = useCallback(
    (branch: string) => {
      navigation.selectRepoBranch(repoId, branch)
    },
    [navigation, repoId],
  )
  const handleOpenBranchStatus = useCallback(
    (branch: string) => {
      handleSelectBranch(branch)
      navigation.showRepoDetailTab(repoId, 'status')
      setDetailCollapsed(false)
    },
    [repoId, handleSelectBranch, navigation, setDetailCollapsed],
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
          a.repo.data.worktreesByPath === b.repo.data.worktreesByPath &&
          a.repo.operations.branchAction === b.repo.operations.branchAction &&
          a.branchCount === b.branchCount &&
          a.selected === b.selected &&
          a.current === b.current,
  )

  // Keep the selected row in view as the user navigates with j/k.
  useEffect(() => {
    const selectedEl = selectedRef.current
    if (selectedEl && variant === 'list') selectedEl.scrollIntoView({ block: 'nearest' })
  }, [selected, variant])

  const selectedBranch =
    repo && selected
      ? (branches.find((branch) => branch.name === selected) ??
        repo.data.branches.find((branch) => branch.name === selected))
      : null
  const renderedBranches = repo
    ? variant === 'selected-strip'
      ? selectedBranch
        ? [selectedBranch]
        : []
      : branches
    : []

  useEffect(() => {
    if (!openActionMenu) return
    if (
      openActionMenu.repoId !== repoId ||
      !showActions ||
      !renderedBranches.some((branch) => branch.name === openActionMenu.branch)
    ) {
      setOpenActionMenu(null)
    }
  }, [openActionMenu, renderedBranches, repoId, showActions])

  if (!repo) return null

  if (renderedBranches.length === 0) {
    return <EmptyState title={t(repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty')} />
  }

  const list = (
    <ul>
      {renderedBranches.map((branch) => {
        return (
          <BranchRow
            key={branch.name}
            repo={repo}
            branch={branch}
            selected={selected}
            current={current}
            onSelectBranch={handleSelectBranch}
            onOpenBranchStatus={handleOpenBranchStatus}
            selectedRef={selectedRef}
            showActions={showActions}
            actionMenuOpen={openActionMenu?.repoId === repoId && openActionMenu.branch === branch.name}
            onActionMenuOpenChange={(open) =>
              setOpenActionMenu((current) =>
                open
                  ? { repoId, branch: branch.name }
                  : current?.repoId === repoId && current.branch === branch.name
                    ? null
                    : current,
              )
            }
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
