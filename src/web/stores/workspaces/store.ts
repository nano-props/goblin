// Multi-workspace client state. Each opened filesystem root is a Workspace
// identified by its canonical workspace id. Git repositories enrich that
// workspace with Git client state; plain directories do not need Git.
//
// `workspaceOrder` controls workspace switcher order; `restoredWorkspaceId` is the workspace
// restored from the previous session for `/` startup routing. Route state owns
// the workspace currently visible on the right. `workspaces[id]` owns the client
// shell, UI intent, command presentation, and session-local state. Git
// domain read data such as branches, status, and worktrees is server/React
// Query authoritative and is composed into presentation models at the UI edge.
//
// Race-condition defenses
//   - `workspaceRuntimeId`: every time a workspace is created/reset we mint a new
//     id. Async writers capture the id at call time and bail when
//     they observe a different id in `set()` — this guards against
//     a stale snapshot from before close-and-reopen overwriting fresh
//     data in the wrong workspace.
import { create } from 'zustand'
import { createBranchActions } from '#/web/stores/workspaces/branch-actions.ts'
import { createGitWorkspaceClientActions } from '#/web/stores/workspaces/git-workspace-client-actions.ts'
import { createWorkspaceSessionActions } from '#/web/stores/workspaces/workspace-session.ts'
import { createSelectionActions } from '#/web/stores/workspaces/selection.ts'
import { createTabOpenerActions } from '#/web/stores/workspaces/tab-opener.ts'
import { DEFAULT_ZEN_MODE, DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
import type { WorkspacesStore } from '#/web/stores/workspaces/types.ts'

export const useWorkspacesStore = create<WorkspacesStore>()((set, get) => ({
  // Runtime-coherent client projection.
  workspaces: {},

  // Restorable workspace state.
  workspaceOrder: [],
  restoredWorkspaceId: null,
  zenMode: DEFAULT_ZEN_MODE,
  workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
  selectedTerminalSessionIdByTerminalFilesystemTarget: {},

  // Local client-only state.
  workspaceMembershipReady: false,
  sessionPersistenceReady: false,
  sessionRestoreError: null,
  restoredClientWorkspaceBaseline: null,
  tabOpenerIdentityByScope: {},
  navigationHistoryByWorkspace: {},

  ...createWorkspaceSessionActions(set, get),
  ...createSelectionActions(set, get),
  ...createTabOpenerActions(set),
  ...createBranchActions(set, get),
  ...createGitWorkspaceClientActions(set),
}))
