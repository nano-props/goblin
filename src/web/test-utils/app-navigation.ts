import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'

// Provider tests need a complete context value, but an unconfigured action must
// fail instead of silently pretending that navigation was rejected or committed.
export function appNavigationActionsForTest(overrides: Partial<AppNavigationActions> = {}): AppNavigationActions {
  return {
    activateWorkspace: unexpectedNavigationAction('activateWorkspace'),
    closeWorkspace: unexpectedNavigationAction('closeWorkspace'),
    cycleWorkspace: unexpectedNavigationAction('cycleWorkspace'),
    selectRepoBranch: unexpectedNavigationAction('selectRepoBranch'),
    selectRepoWorktree: unexpectedNavigationAction('selectRepoWorktree'),
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

function unexpectedNavigationAction(name: keyof AppNavigationActions): () => never {
  return () => {
    throw new Error(`Unexpected app navigation action in test: ${name}`)
  }
}
