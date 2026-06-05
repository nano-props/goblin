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
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'

interface Props {
  repoId: string
  showActions?: boolean
  variant?: 'list' | 'selected-strip'
}

type OpenActionMenu = { repoId: string; branch: string }

type BranchListRepo = BranchActionRepo & {
  data: BranchActionRepo['data'] & {
    branches: RepoBranchState[]
  }
  ui: {
    selectedBranch: string | null
    branchViewMode: 'all' | 'worktrees' | 'no-worktree'
  }
}

function branchListRepoEqual(a: BranchListRepo | undefined, b: BranchListRepo | undefined): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.instanceToken === b.instanceToken &&
      a.data.branches === b.data.branches &&
      a.data.currentBranch === b.data.currentBranch &&
      a.data.status === b.data.status &&
      a.data.worktreesByPath === b.data.worktreesByPath &&
      a.ui.selectedBranch === b.ui.selectedBranch &&
      a.ui.branchViewMode === b.ui.branchViewMode &&
      a.operations.branchAction === b.operations.branchAction &&
      a.remote.target === b.remote.target &&
      a.remote.hasRemotes === b.remote.hasRemotes &&
      a.remote.hasBrowserRemote === b.remote.hasBrowserRemote &&
      a.remote.hasGitHubRemote === b.remote.hasGitHubRemote &&
      a.remote.browserRemoteProvider === b.remote.browserRemoteProvider &&
      a.remote.remoteProviders === b.remote.remoteProviders)
  )
}

export function BranchList({ repoId, showActions = true, variant = 'list' }: Props) {
  const t = useT()
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
  const branchSearchQuery = useReposStore((s) => s.branchSearchQueries[repoId] ?? '')
  const repo = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      return repo
        ? {
            id: repo.id,
            instanceToken: repo.instanceToken,
            data: {
              branches: repo.data.branches,
              currentBranch: repo.data.currentBranch,
              status: repo.data.status,
              worktreesByPath: repo.data.worktreesByPath,
            },
            ui: {
              selectedBranch: repo.ui.selectedBranch,
              branchViewMode: repo.ui.branchViewMode,
            },
            operations: {
              branchAction: repo.operations.branchAction,
            },
            remote: {
              target: repo.remote.target,
              hasRemotes: repo.remote.hasRemotes,
              hasBrowserRemote: repo.remote.hasBrowserRemote,
              hasGitHubRemote: repo.remote.hasGitHubRemote,
              browserRemoteProvider: repo.remote.browserRemoteProvider,
              remoteProviders: repo.remote.remoteProviders,
            },
          }
        : undefined
    },
    branchListRepoEqual,
  )

  // Keep the selected row in view as the user navigates with j/k.
  useEffect(() => {
    const selectedEl = selectedRef.current
    if (selectedEl && variant === 'list') selectedEl.scrollIntoView({ block: 'nearest' })
  }, [repo?.ui.selectedBranch, variant])

  if (!repo) return null

  const branches = visibleBranches({
    branches: repo.data.branches,
    viewMode: repo.ui.branchViewMode,
    searchQuery: branchSearchQuery,
  })
  const selectedBranch =
    repo.ui.selectedBranch
      ? (branches.find((branch) => branch.name === repo.ui.selectedBranch) ??
        repo.data.branches.find((branch) => branch.name === repo.ui.selectedBranch))
      : null
  const renderedBranches = variant === 'selected-strip' ? (selectedBranch ? [selectedBranch] : []) : branches

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
            selected={repo.ui.selectedBranch}
            current={repo.data.currentBranch}
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
