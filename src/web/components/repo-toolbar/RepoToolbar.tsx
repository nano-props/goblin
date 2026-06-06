import { ChevronDown, ChevronUp } from 'lucide-react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { Button } from '#/web/components/ui/button.tsx'
import { BranchSearchInput } from '#/web/components/repo-toolbar/BranchSearchInput.tsx'
import { BranchViewModeControl } from '#/web/components/repo-toolbar/BranchViewModeControl.tsx'
import { RepoToolbarActions } from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { WorkspaceLayoutControl } from '#/web/components/repo-toolbar/WorkspaceLayoutControl.tsx'
import { Toolbar } from '#/web/components/Layout.tsx'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { visibleBranches } from '#/web/stores/repos/branch-view-mode.ts'
import { useT } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { BranchViewMode } from '#/web/stores/repos/types.ts'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
interface Props {
  repoId: string
}

export function RepoToolbar({ repoId }: Props) {
  const exists = useReposStore((s) => !!s.repos[repoId])
  if (!exists) return null

  return (
    <Toolbar variant="repo" className="justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <BranchFilterControls repoId={repoId} />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <RepoToolbarActions repoId={repoId} />
        <WorkspaceLayoutControlConnected />
      </div>
    </Toolbar>
  )
}

function BranchFilterControls({ repoId }: Props) {
  const t = useT()
  const uiMode = useResponsiveUiMode()
  const navigation = useMainWindowNavigation()
  const { focusedLayout, branches, selectedBranch } = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      const layout = s.workspaceLayout
      const behavior = repoWorkspaceBehavior(layout, s.detailCollapsed, s.detailFocusMode)
      return {
        focusedLayout: behavior.mode === 'focus',
        branches: repo
          ? visibleBranches({
              branches: repo.data.branches,
              viewMode: repo.ui.branchViewMode,
            })
          : [],
        selectedBranch: repo?.ui.selectedBranch ?? null,
      }
    },
    (a, b) =>
      a.focusedLayout === b.focusedLayout &&
      a.branches === b.branches &&
      a.selectedBranch === b.selectedBranch,
  )
  const { branchCount, branchViewMode, branchSearchQuery } = useStoreWithEqualityFn(
    useReposStore,
    (s) => ({
      branchCount: s.repos[repoId]?.data.branches.length ?? 0,
      branchViewMode: s.repos[repoId]?.ui.branchViewMode ?? 'all',
      branchSearchQuery: s.branchSearchQueries[repoId] ?? '',
    }),
    (a, b) =>
      a.branchCount === b.branchCount &&
      a.branchViewMode === b.branchViewMode &&
      a.branchSearchQuery === b.branchSearchQuery,
  )
  const setBranchViewMode = useReposStore((s) => s.setBranchViewMode)
  const setBranchSearchQuery = useReposStore((s) => s.setBranchSearchQuery)
  const branchPager = (
    <BranchPager
      repoId={repoId}
      branches={branches}
      selectedBranch={selectedBranch}
      focusedLayout={focusedLayout}
      navigation={navigation}
    />
  )

  if (focusedLayout) return branchPager
  if (uiMode === 'compact') return branchPager

  return (
    <>
      <div className="flex items-center gap-2">
        <BranchViewModeControl
          value={branchViewMode as BranchViewMode}
          disabled={branchCount === 0}
          onChange={(viewMode) => setBranchViewMode(repoId, viewMode)}
        />
        <BranchSearchInput
          value={branchSearchQuery}
          disabled={branchCount === 0}
          onChange={(query) => setBranchSearchQuery(repoId, query)}
        />
      </div>
    </>
  )
}

function BranchPager({
  repoId,
  branches,
  selectedBranch,
  focusedLayout,
  navigation,
}: {
  repoId: string
  branches: { name: string }[]
  selectedBranch: string | null
  focusedLayout: boolean
  navigation: ReturnType<typeof useMainWindowNavigation>
}) {
  const t = useT()
  if (branches.length === 0) return null
  const index = branches.findIndex((branch) => branch.name === selectedBranch)
  const previous = index > 0 ? branches[index - 1] : null
  const next = index >= 0 && index < branches.length - 1 ? branches[index + 1] : null
  const current = index >= 0 ? index + 1 : 1

  return (
    <div className="flex items-center gap-1">
      <span
        className="min-w-0 shrink-0 px-1 text-[11px] font-medium tabular-nums text-muted-foreground"
        aria-label={focusedLayout ? t('branches.selected') : undefined}
      >
        {current} / {branches.length}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!previous}
        aria-label={t('help.row.prev-branch')}
        title={t('help.row.prev-branch')}
        onClick={() => previous && navigation.selectRepoBranch(repoId, previous.name)}
      >
        <ChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!next}
        aria-label={t('help.row.next-branch')}
        title={t('help.row.next-branch')}
        onClick={() => next && navigation.selectRepoBranch(repoId, next.name)}
      >
        <ChevronDown />
      </Button>
    </div>
  )
}

function WorkspaceLayoutControlConnected() {
  const uiMode = useResponsiveUiMode()
  const workspaceLayout = useReposStore((s) => s.workspaceLayout)
  const setWorkspaceLayout = useReposStore((s) => s.setWorkspaceLayout)
  if (uiMode === 'compact') return null

  return <WorkspaceLayoutControl value={workspaceLayout} onChange={setWorkspaceLayout} />
}
