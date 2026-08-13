import { replaceWorkspaceState } from '#/web/stores/workspaces/workspace-state-factory.ts'
import {
  DEFAULT_WORKSPACE_PANE_SIZE,
  normalizeWorkspacePaneSize,
  normalizeWorkspaceSessionLayoutState,
} from '#/shared/workspace-layout.ts'
import type {
  GitWorkspacePreferenceActions,
  RestorableWorkspaceActions,
  WorkspacePanePreferenceActions,
  WorkspacesGet,
  WorkspacesSet,
} from '#/web/stores/workspaces/types.ts'
import type { BranchViewMode } from '#/shared/api-types.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { isGitWorkspace } from '#/web/stores/workspaces/git-workspace-client-state.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import {
  preferredWorkspacePaneTabForTarget,
  preferredWorkspacePaneTabByTargetRecordWith,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { requireRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import { createWorkspaceNavigationHistoryActions } from '#/web/stores/workspaces/navigation-history-actions.ts'

function createRestorableWorkspaceActions(set: WorkspacesSet): RestorableWorkspaceActions {
  return {
    applySessionLayoutState(layoutState) {
      // One-shot boot/session restore of restorable layout fields. Runtime
      // edits are persisted later through useClientWorkspacePersistence.
      set((s) => {
        const next = normalizeWorkspaceSessionLayoutState(layoutState)
        if (s.zenMode === next.zenMode && s.workspacePaneSize === next.workspacePaneSize) {
          return s
        }
        return {
          zenMode: next.zenMode,
          workspacePaneSize: next.workspacePaneSize,
        }
      })
    },

    applySessionSelectedTerminalState(selectedTerminalSessionIdByTerminalFilesystemTarget: Record<string, string>) {
      // One-shot boot/session restore of per-filesystem-target terminal selection. This
      // seeds client state; later selection changes remain client-owned.
      set((s) => {
        const current = s.selectedTerminalSessionIdByTerminalFilesystemTarget
        const currentEntries = Object.entries(current)
        const nextEntries = Object.entries(selectedTerminalSessionIdByTerminalFilesystemTarget)
        if (
          currentEntries.length === nextEntries.length &&
          nextEntries.every(
            ([terminalFilesystemTargetKey, terminalSessionId]) =>
              current[terminalFilesystemTargetKey] === terminalSessionId,
          )
        ) {
          return s
        }
        return {
          selectedTerminalSessionIdByTerminalFilesystemTarget: {
            ...selectedTerminalSessionIdByTerminalFilesystemTarget,
          },
        }
      })
    },

    applySessionBranchViewModes(branchViewModeByWorkspace) {
      set({ branchViewModeByWorkspace: { ...branchViewModeByWorkspace } })
    },

    setZenMode(enabled: boolean) {
      set((s) => (s.zenMode === enabled ? s : { zenMode: enabled }))
    },

    toggleZenMode() {
      set((s) => ({ zenMode: !s.zenMode }))
    },

    setWorkspacePaneSize(size: number) {
      set((s) => {
        const next = normalizeWorkspacePaneSize(size)
        if (s.workspacePaneSize === next) return s
        return { workspacePaneSize: next }
      })
    },

    resetLayout() {
      set((s) => {
        if (s.workspacePaneSize === DEFAULT_WORKSPACE_PANE_SIZE) {
          return s
        }
        return {
          workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
        }
      })
    },

    setSelectedTerminal(terminalFilesystemTargetKey: string, terminalSessionId: string | null) {
      set((s) => {
        const current = s.selectedTerminalSessionIdByTerminalFilesystemTarget[terminalFilesystemTargetKey]
        if (terminalSessionId) {
          if (current === terminalSessionId) return s
          return {
            selectedTerminalSessionIdByTerminalFilesystemTarget: {
              ...s.selectedTerminalSessionIdByTerminalFilesystemTarget,
              [terminalFilesystemTargetKey]: terminalSessionId,
            },
          }
        }
        if (current === undefined) return s
        const selectedTerminalSessionIdByTerminalFilesystemTarget = {
          ...s.selectedTerminalSessionIdByTerminalFilesystemTarget,
        }
        delete selectedTerminalSessionIdByTerminalFilesystemTarget[terminalFilesystemTargetKey]
        return { selectedTerminalSessionIdByTerminalFilesystemTarget }
      })
    },
  }
}

function setWorkspacePaneTabForTarget(
  set: WorkspacesSet,
  target: WorkspacePaneTabsTarget,
  tab: WorkspacePaneTabType | null,
): void {
  set((state) => {
    const workspace = state.workspaces[target.workspaceId]
    if (!workspace || preferredWorkspacePaneTabForTarget(workspace.ui, target) === tab) return state
    return replaceWorkspaceState(state, workspace, (nextWorkspace) => {
      nextWorkspace.ui.preferredWorkspacePaneTabByTarget = preferredWorkspacePaneTabByTargetRecordWith(
        nextWorkspace.ui,
        target,
        tab,
      )
    })
  })
}

function createWorkspacePanePreferenceActions(set: WorkspacesSet): WorkspacePanePreferenceActions {
  return {
    setWorkspacePaneTabForTarget: (target, tab) => setWorkspacePaneTabForTarget(set, target, tab),
  }
}

function createGitWorkspacePreferenceActions(set: WorkspacesSet, get: WorkspacesGet): GitWorkspacePreferenceActions {
  return {
    setBranchViewMode(id: string, viewMode: BranchViewMode) {
      set((s) => {
        const repo = s.workspaces[id]
        if (!repo || !isGitWorkspace(repo) || s.branchViewModeByWorkspace[id] === viewMode) return s
        return { branchViewModeByWorkspace: branchViewModeByWorkspaceWith(s.branchViewModeByWorkspace, id, viewMode) }
      })
    },

    setWorkspacePaneTab(id: string, branch: string, tab: WorkspacePaneTabType | null) {
      const repo = get().workspaces[id]
      if (!repo) return
      const branchModel = requireRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)
      const target = workspacePaneTabsTargetForRepoBranch(
        { workspaceId: repo.id, branches: branchModel.branches, worktrees: branchModel.worktrees },
        branch,
      )
      if (target) setWorkspacePaneTabForTarget(set, target, tab)
    },
  }
}

function branchViewModeByWorkspaceWith(
  current: Record<string, BranchViewMode>,
  workspaceId: string,
  viewMode: BranchViewMode,
): Record<string, BranchViewMode> {
  return { ...current, [workspaceId]: viewMode }
}

export function createSelectionActions(set: WorkspacesSet, get: WorkspacesGet) {
  return {
    ...createRestorableWorkspaceActions(set),
    ...createWorkspacePanePreferenceActions(set),
    ...createGitWorkspacePreferenceActions(set, get),
    ...createWorkspaceNavigationHistoryActions(set, get),
  }
}
