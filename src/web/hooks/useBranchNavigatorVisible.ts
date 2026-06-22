import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

/** Whether the branch navigator pane is currently on screen. Topbar
 * controls that operate on the branch list (worktree filter, etc.)
 * should hide themselves when this is false — see
 * `repoWorkspaceBehavior.branchNavigatorVisible` for the rules. */
export function useBranchNavigatorVisible(repoId: string): boolean {
  const compact = useIsCompactUi()
  const workspaceFocused = useReposStore((s) => s.workspaceFocused)
  const branchWorkspaceActive = useStoreWithEqualityFn(
    useReposStore,
    (s) => !!s.repos[repoId]?.ui.selectedBranch,
    (a, b) => a === b,
  )
  return repoWorkspaceBehavior({ compact, workspaceFocused, branchWorkspaceActive }).branchNavigatorVisible
}