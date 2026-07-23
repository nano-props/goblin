import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'

// Provider tests need a complete context value, but an unconfigured action must
// fail instead of silently pretending that navigation was rejected or committed.
export function primaryWindowNavigationActionsForTest(
  overrides: Partial<PrimaryWindowNavigationActions> = {},
): PrimaryWindowNavigationActions {
  return {
    activateWorkspace: unexpectedNavigationAction('activateWorkspace'),
    closeWorkspace: unexpectedNavigationAction('closeWorkspace'),
    cycleWorkspace: unexpectedNavigationAction('cycleWorkspace'),
    selectRepoBranch: unexpectedNavigationAction('selectRepoBranch'),
    showRepoBranchEmptyWorkspacePane: unexpectedNavigationAction('showRepoBranchEmptyWorkspacePane'),
    showRepoBranchWorkspacePaneTab: unexpectedNavigationAction('showRepoBranchWorkspacePaneTab'),
    showRepoBranchTerminalSession: unexpectedNavigationAction('showRepoBranchTerminalSession'),
    showRepoWorktreeTerminalSession: unexpectedNavigationAction('showRepoWorktreeTerminalSession'),
    showWorkspaceRootPaneTab: unexpectedNavigationAction('showWorkspaceRootPaneTab'),
    commitFilesystemWorkspacePaneRoute: unexpectedNavigationAction('commitFilesystemWorkspacePaneRoute'),
    commitWorkspaceRootTerminalSession: unexpectedNavigationAction('commitWorkspaceRootTerminalSession'),
    commitWorkspacePaneRoute: unexpectedNavigationAction('commitWorkspacePaneRoute'),
    currentWorkspacePaneRoute: unexpectedNavigationAction('currentWorkspacePaneRoute'),
    goBack: unexpectedNavigationAction('goBack'),
    goForward: unexpectedNavigationAction('goForward'),
    openSettings: unexpectedNavigationAction('openSettings'),
    openCreateWorktree: unexpectedNavigationAction('openCreateWorktree'),
    ...overrides,
  }
}

function unexpectedNavigationAction(name: keyof PrimaryWindowNavigationActions): () => never {
  return () => {
    throw new Error(`Unexpected primary window navigation action in test: ${name}`)
  }
}
