// Focus-mode branch info bar. Renders the selected-branch summary, the
// branch switcher dropdown, the HEAD label, and branch-level actions on
// top of the shared RepoToolbar chrome. Caller is expected to mount
// this only in focus mode (see RepoView / RepoWorkspaceSkeleton for the
// pattern); the bar itself does not check.
//
// The per-repo actions (Refresh, worktree filter, new worktree) live
// in the Topbar now — see `Topbar.tsx` and `App.tsx` — so this bar
// does not duplicate them.

import { ChevronDown } from 'lucide-react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  SelectedDropdownMenuItem,
} from '#/web/components/ui/dropdown-menu.tsx'
import { focusRing, openRing } from '#/web/components/ui/focus.ts'
import { BranchActionControls } from '#/web/components/BranchActionControls.tsx'
import {
  BranchSummaryIcon,
  BranchSummaryMeta,
  buildBranchSummaryTitle,
  computeBranchSummaryState,
  type BranchSummaryInlineRepo,
} from '#/web/components/repo-workspace/BranchSummaryInline.tsx'
import { RepoToolbar } from '#/web/components/repo-toolbar/RepoToolbar.tsx'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import { useBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { useBranchActionShortcutRegistry } from '#/web/hooks/useBranchActionShortcutRegistry.ts'
import { visibleBranches } from '#/web/stores/repos/branch-view-mode.ts'
import { useI18nStore, useT } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { cn } from '#/web/lib/cn.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'

interface Props {
  repoId: string
}

export function BranchInfoBar({ repoId }: Props) {
  return (
    <RepoToolbar>
      <FocusBranchControls repoId={repoId} />
    </RepoToolbar>
  )
}

function FocusBranchControls({ repoId }: Props) {
  const navigation = useMainWindowNavigation()
  const { branches, selectedBranch, selectedBranchData, summaryRepo, currentHEAD } = useStoreWithEqualityFn(
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
        currentHEAD: repo?.data.currentHEAD,
      }
    },
    (a, b) =>
      a.branches === b.branches &&
      a.selectedBranch === b.selectedBranch &&
      a.selectedBranchData === b.selectedBranchData &&
      a.summaryRepo?.data.currentBranch === b.summaryRepo?.data.currentBranch &&
      a.summaryRepo?.data.status === b.summaryRepo?.data.status &&
      a.summaryRepo?.data.worktreesByPath === b.summaryRepo?.data.worktreesByPath &&
      a.currentHEAD === b.currentHEAD,
  )

  return (
    <div className="flex min-w-0 items-center gap-2">
      {selectedBranchData && summaryRepo && (
        <FocusBranchSummary
          repoId={repoId}
          repo={summaryRepo}
          branch={selectedBranchData}
          branches={branches}
          selectedBranch={selectedBranch}
          navigation={navigation}
          className="min-w-0 flex-1"
        />
      )}
      {currentHEAD && (
        <>
          <div aria-hidden="true" className="mx-1 h-4 border-l border-separator/70" />
          <span className="shrink-0 font-mono text-xs text-muted-foreground">HEAD at {currentHEAD}</span>
        </>
      )}
      {selectedBranchData && <FocusBranchActions repoId={repoId} branch={selectedBranchData} />}
    </div>
  )
}

const FOCUS_BRANCH_ACTIONS_REPO_EQUAL = (a: BranchActionRepo | undefined, b: BranchActionRepo | undefined) =>
  a === b ||
  (!!a &&
    !!b &&
    a.id === b.id &&
    a.instanceToken === b.instanceToken &&
    a.data.currentBranch === b.data.currentBranch &&
    a.data.status === b.data.status &&
    a.data.worktreesByPath === b.data.worktreesByPath &&
    a.operations.branchAction === b.operations.branchAction &&
    a.remote.hasRemotes === b.remote.hasRemotes &&
    a.remote.hasBrowserRemote === b.remote.hasBrowserRemote &&
    a.remote.hasGitHubRemote === b.remote.hasGitHubRemote &&
    a.remote.lifecycle === b.remote.lifecycle &&
    a.remote.browserRemoteProvider === b.remote.browserRemoteProvider &&
    a.remote.remoteProviders === b.remote.remoteProviders)

function FocusBranchActions({ repoId, branch }: { repoId: string; branch: RepoBranchState }) {
  const repo = useStoreWithEqualityFn(
    useReposStore,
    (s): BranchActionRepo | undefined => {
      const repoState = s.repos[repoId]
      if (!repoState) return undefined
      return {
        id: repoState.id,
        instanceToken: repoState.instanceToken,
        data: {
          currentBranch: repoState.data.currentBranch,
          status: repoState.data.status,
          worktreesByPath: repoState.data.worktreesByPath,
        },
        operations: {
          branchAction: repoState.operations.branchAction,
        },
        remote: {
          hasRemotes: repoState.remote.hasRemotes,
          hasBrowserRemote: repoState.remote.hasBrowserRemote,
          hasGitHubRemote: repoState.remote.hasGitHubRemote,
          lifecycle: repoState.remote.lifecycle,
          browserRemoteProvider: repoState.remote.browserRemoteProvider,
          remoteProviders: repoState.remote.remoteProviders,
        },
      }
    },
    FOCUS_BRANCH_ACTIONS_REPO_EQUAL,
  )

  // FocusBranchActions is only mounted when FocusBranchControls has a
  // selectedBranchData branch, which implies repo exists in the store.
  const actions = useBranchActionItems(repo!, branch)
  useBranchActionShortcutRegistry(actions)

  if (!repo) return null

  return (
    <>
      {actions.dialogs}
      <BranchActionControls actions={actions} variant="menu" />
    </>
  )
}

// The focus-mode row: read-only status icon, then a dropdown trigger
// over the branch name + chevron, then the read-only status strip
// (badges · deltas · last commit). The dropdown trigger is the only
// interactive part of the row — the icon and the meta stay non-clickable
// because the meta is informational (the user shouldn't expect badges
// or commit timestamps to open a branch picker).
function FocusBranchSummary({
  repoId,
  repo,
  branch,
  branches,
  selectedBranch,
  navigation,
  className,
}: {
  repoId: string
  repo: BranchSummaryInlineRepo
  branch: RepoBranchState
  branches: { name: string }[]
  selectedBranch: string | null
  navigation: ReturnType<typeof useMainWindowNavigation>
  className?: string
}) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const state = computeBranchSummaryState(branch, repo, lang)
  const { isCurrent, isWorktree, worktreeDirty } = state
  const title = buildBranchSummaryTitle(state, branch, t)

  return (
    <div title={title} className={cn('flex min-w-0 items-center gap-2', className)}>
      <BranchSummaryIcon
        isCurrent={isCurrent}
        isWorktree={isWorktree}
        worktreeDirty={worktreeDirty}
        selected={false}
      />
      {branches.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                // Sizing matches Button size="sm" (h-6) so the trigger
                // sits on the same baseline as the adjacent text-xs
                // meta. gap-1 keeps the chevron visually attached to
                // the name without crowding it. shrink-0 lets long
                // branch names push the trailing meta off-screen
                // (rather than compressing the click target); the meta
                // already has overflow-hidden + min-w-0 to handle
                // truncation.
                'inline-flex h-6 shrink-0 items-center gap-1 rounded-sm px-2',
                'text-foreground',
                'hover:bg-accent hover:text-accent-foreground',
                'data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
                'transition-colors duration-100 cursor-pointer outline-none',
                focusRing,
                openRing,
              )}
              title={t('branches.switch')}
              aria-label={t('branches.switch')}
              aria-haspopup="menu"
            >
              <span className="truncate text-sm font-medium">{branch.name}</span>
              <ChevronDown className="size-3 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="w-max">
            {branches.map((b) => (
              <SelectedDropdownMenuItem
                key={b.name}
                selected={b.name === selectedBranch}
                className="whitespace-nowrap"
                onSelect={() => navigation.selectRepoBranch(repoId, b.name)}
                aria-current={b.name === selectedBranch ? 'true' : undefined}
              >
                {b.name}
              </SelectedDropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="truncate text-sm font-medium text-foreground">{branch.name}</span>
      )}
      <BranchSummaryMeta repo={repo} branch={branch} />
    </div>
  )
}
