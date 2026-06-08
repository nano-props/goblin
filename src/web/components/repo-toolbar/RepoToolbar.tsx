import { ChevronDown } from 'lucide-react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { Button } from '#/web/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/web/components/ui/dropdown-menu.tsx'
import { BranchSearchInput } from '#/web/components/repo-toolbar/BranchSearchInput.tsx'
import { BranchViewModeControl } from '#/web/components/repo-toolbar/BranchViewModeControl.tsx'
import { RepoToolbarActions } from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { WorkspaceLayoutControl } from '#/web/components/repo-toolbar/WorkspaceLayoutControl.tsx'
import { BranchSummaryInline } from '#/web/components/repo-workspace/BranchSummaryInline.tsx'
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

  const focusMode = useReposStore((s) => {
    const behavior = repoWorkspaceBehavior(s.workspaceLayout, s.detailCollapsed, s.detailFocusMode)
    return behavior.mode === 'focus'
  })

  return (
    <Toolbar variant="repo" className="justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {focusMode ? (
          <FocusBranchControls repoId={repoId} />
        ) : (
          <BranchFilterControls repoId={repoId} />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <RepoToolbarActions repoId={repoId} />
        <WorkspaceLayoutControlConnected />
      </div>
    </Toolbar>
  )
}

function FocusBranchControls({ repoId }: Props) {
  const navigation = useMainWindowNavigation()
  const { branches, selectedBranch, selectedBranchData, summaryRepo } = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      return {
        branches: repo
          ? visibleBranches({
              branches: repo.data.branches,
              viewMode: repo.ui.branchViewMode,
            })
          : [],
        selectedBranch: repo?.ui.selectedBranch ?? null,
        selectedBranchData: repo?.ui.selectedBranch
          ? (repo.data.branches.find((branch) => branch.name === repo.ui.selectedBranch) ?? null)
          : null,
        summaryRepo: repo
          ? {
              data: {
                currentBranch: repo.data.currentBranch,
                status: repo.data.status,
                worktreesByPath: repo.data.worktreesByPath,
              },
            }
          : null,
      }
    },
    (a, b) =>
      a.branches === b.branches &&
      a.selectedBranch === b.selectedBranch &&
      a.selectedBranchData === b.selectedBranchData &&
      a.summaryRepo?.data.currentBranch === b.summaryRepo?.data.currentBranch &&
      a.summaryRepo?.data.status === b.summaryRepo?.data.status &&
      a.summaryRepo?.data.worktreesByPath === b.summaryRepo?.data.worktreesByPath,
  )

  return (
    <div className="flex min-w-0 items-center gap-2">
      <BranchSelector
        repoId={repoId}
        branches={branches}
        selectedBranch={selectedBranch}
        navigation={navigation}
      />
      {selectedBranchData && summaryRepo && (
        <>
          <div aria-hidden="true" className="mx-1 h-4 border-l border-separator/70" />
          <BranchSummaryInline repo={summaryRepo} branch={selectedBranchData} className="min-w-0 flex-1" />
        </>
      )}
    </div>
  )
}

function BranchFilterControls({ repoId }: Props) {
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

  return (
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
  )
}

function BranchSelector({
  repoId,
  branches,
  selectedBranch,
  navigation,
}: {
  repoId: string
  branches: { name: string }[]
  selectedBranch: string | null
  navigation: ReturnType<typeof useMainWindowNavigation>
}) {
  const t = useT()
  if (branches.length === 0) return null
  const index = branches.findIndex((branch) => branch.name === selectedBranch)
  const current = index >= 0 ? index + 1 : 1

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="gap-1 tabular-nums text-muted-foreground"
          aria-label={t('branches.switch')}
          title={t('branches.switch')}
        >
          <span>{current} / {branches.length}</span>
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-max">
        {branches.map((branch) => (
          <DropdownMenuItem
            key={branch.name}
            className="whitespace-nowrap"
            disabled={branch.name === selectedBranch}
            onSelect={() => navigation.selectRepoBranch(repoId, branch.name)}
          >
            <span className={branch.name === selectedBranch ? 'text-muted-foreground' : undefined}>
              {branch.name}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function WorkspaceLayoutControlConnected() {
  const uiMode = useResponsiveUiMode()
  const workspaceLayout = useReposStore((s) => s.workspaceLayout)
  const setWorkspaceLayout = useReposStore((s) => s.setWorkspaceLayout)
  if (uiMode === 'compact') return null

  return <WorkspaceLayoutControl value={workspaceLayout} onChange={setWorkspaceLayout} />
}
