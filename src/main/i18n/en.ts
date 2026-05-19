// English dictionary. Keep keys in sync with zh.ts, ko.ts, and ja.ts.
//
// Style: terse, sentence case for buttons/menu items, period-terminated
// sentences for hints. Brand names (Goblin / GitHub / Finder) are not
// translated.

export const en = {
  // ---- Menu (top-level) ---------------------------------------------------
  'menu.file': 'File',
  'menu.edit': 'Edit',
  'menu.view': 'View',
  'menu.window': 'Window',
  'menu.help': 'Help',

  // ---- Menu — App (macOS application menu) --------------------------------
  'menu.app.about': 'About {name}',
  'menu.app.services': 'Services',
  'menu.app.hide': 'Hide {name}',
  'menu.app.hideOthers': 'Hide Others',
  'menu.app.showAll': 'Show All',
  'menu.app.quit': 'Quit {name}',
  'menu.app.settings': 'Settings…',

  // ---- Menu — Window (macOS) ----------------------------------------------
  'menu.window.minimize': 'Minimize',
  'menu.window.zoom': 'Zoom',
  'menu.window.front': 'Bring All to Front',

  // ---- Menu — File --------------------------------------------------------
  'menu.file.openRepo': 'Open Repository…',
  'menu.file.closeTab': 'Close Tab',
  'menu.file.settings': 'Settings…',
  'menu.file.quit': 'Quit',

  // ---- Menu — Edit --------------------------------------------------------
  'menu.edit.cut': 'Cut',
  'menu.edit.copy': 'Copy',
  'menu.edit.paste': 'Paste',
  'menu.edit.selectAll': 'Select All',

  // ---- Menu — View --------------------------------------------------------
  'menu.view.branches': 'Branches',
  'menu.view.status': 'Status',
  'menu.view.log': 'Log',
  'menu.view.refresh': 'Refresh',
  'menu.view.toggleTheme': 'Toggle Theme',
  'menu.view.toggleDevTools': 'Toggle Developer Tools',

  // ---- Menu — Window (gbl-specific) ---------------------------------------
  'menu.window.nextRepo': 'Next Repository',
  'menu.window.prevRepo': 'Previous Repository',

  // ---- Menu — Help --------------------------------------------------------
  'menu.help.shortcuts': 'Keyboard Shortcuts',

  // ---- Topbar -------------------------------------------------------------
  'topbar.open': 'Open',
  'topbar.help': 'Keyboard shortcuts (?)',
  'topbar.settings': 'Settings (⌘,)',

  // ---- Repository tabs ----------------------------------------------------
  'repoTabs.repos': 'Repositories',
  'repoTabs.empty.before': 'Click the ',
  'repoTabs.empty.openLabel': 'Open',
  'repoTabs.empty.after': ' button in the tab strip to add a git repository.',
  'repoTabs.close': 'Close',
  'repoTabs.dragToReorder': 'Drag to reorder',
  'repoTabs.missingTitle': "Couldn't reopen {n} repository",
  'repoTabs.missingDismiss': 'Dismiss',

  // ---- Empty state --------------------------------------------------------
  'empty.title': 'No repository open',
  // Body split into segments so React renders the bold/kbd parts as real
  // elements (no dangerouslySetInnerHTML).
  'empty.body.before': 'Click ',
  'empty.body.openLabel': 'Open',
  'empty.body.middle':
    ' in the tab strip above to add a git repository. You can keep multiple repositories open and switch between them there. Press ',
  'empty.body.after': ' for shortcuts.',

  // ---- Drag and drop ------------------------------------------------------
  'drop.title': 'Drop to open repository',
  'drop.body': 'Drop a Git repository folder anywhere in Goblin.',
  'drop.openFailed': 'Could not open repository',

  // ---- Right-side tabs ----------------------------------------------------
  'tab.branches': 'Branches',
  'tab.status': 'Status',
  'tab.log': 'Log',
  'tab.fetching': 'fetch',
  'tab.fetchingTitle': 'Background fetch in progress',
  'tab.fetchFailed': 'fetch failed',
  'tab.fetchFailedTitle': 'Most recent background fetch failed — check network or remote.',

  // ---- Branches list ------------------------------------------------------
  'branches.empty': 'No branches found in this repository.',
  'branches.gone': 'gone',
  'branches.dirty': 'dirty',
  'branches.worktree': 'wt',
  'branches.default': 'default',
  'branches.noUpstream': 'No upstream',

  // ---- Log list -----------------------------------------------------------
  'log.showingBranch': 'Commits',
  'log.empty': 'No commits to show.',
  'log.emptyForBranch': 'No commits to show for {branch}.',

  // ---- Status -------------------------------------------------------------
  'status.cleanTitle': 'Working tree is clean',
  'status.cleanBody': 'No changes to commit.',
  'status.mainWorktree': 'main',
  'status.worktreeClean': 'clean',
  'status.staged': 'Staged',
  'status.stagedHint': 'Ready to commit',
  'status.unstaged': 'Unstaged',
  'status.unstagedHint': 'Modified in worktree',
  'status.untracked': 'Untracked',
  'status.untrackedHint': 'Not yet added',
  'status.label.untracked': 'untracked',
  'status.label.ignored': 'ignored',
  'status.label.added': 'added',
  'status.label.deleted': 'deleted',
  'status.label.modified': 'modified',
  'status.label.renamed': 'renamed',
  'status.label.copied': 'copied',
  'status.label.conflict': 'conflict',
  'status.label.changed': 'changed',
  'status.copyPatch': 'Copy patch',
  'status.copyPatchTitle': 'Copy a git apply --binary patch of this worktree to the clipboard',
  'status.copyPatchOk': 'Patch copied to clipboard',
  'status.copyPatchEmpty': 'Nothing to copy — worktree is clean',

  // ---- Worktree row actions (used by branch rows that have a worktree) ---
  'worktrees.revealTitle': 'Reveal in Finder',
  'worktrees.openInGhosttyTitle': 'Open in Ghostty',
  'worktrees.openInGhosttyLabel': 'Ghostty',

  // ---- Repo actions -------------------------------------------------------
  'action.checkout': 'Checkout',
  'action.pull': 'Pull',
  'action.push': 'Push',
  'action.fetch': 'Fetch',
  'action.github': 'GitHub',
  'action.deleteBranch': 'Delete branch',
  'action.removeWorktree': 'Remove worktree',
  'action.checkoutCurrent': 'Already on this branch',
  'action.checkoutInWorktree': 'Already checked out in worktree at {path}',
  'action.checkoutTitle': 'Checkout {branch}',
  'action.pullFrom': 'Pull from {tracking}',
  'action.pullNoUpstream': 'No upstream',
  'action.pushTitle': 'Push {branch} to origin',
  'action.fetchTitle': 'git fetch --all --prune',
  'action.githubTitle': 'Open repo in browser',
  'action.resultOk': 'OK',
  'action.resultError': 'Error',
  'action.confirmPushProtectedTitle': 'Push to {branch}?',
  'action.confirmPushProtectedBody.before': 'You are about to push directly to ',
  'action.confirmPushProtectedBody.after': ', which usually deserves a pull request. Continue?',
  'action.confirmPushConfirm': 'Push anyway',
  'action.confirmDeleteBranchTitle': 'Delete {branch}?',
  'action.confirmDeleteBranchBody.before': 'This will delete local branch ',
  'action.confirmDeleteBranchBody.after': '. Git will refuse if it is not fully merged.',
  'action.confirmDeleteBranchConfirm': 'Delete branch',
  'action.confirmRemoveWorktreeTitle': 'Remove worktree for {branch}?',
  'action.confirmRemoveWorktreeBody.before': 'This will delete the worktree directory at ',
  'action.confirmRemoveWorktreeBody.after': '.',
  'action.confirmRemoveWorktreeConfirm': 'Remove worktree',
  'action.confirmRemoveWorktreeAlsoDeleteBranch': 'Also delete branch {branch}',
  'action.confirmRemoveWorktreeProtectedHint': "This branch is protected — it can't be deleted from here.",
  'action.createWorktree': 'New worktree',
  'action.createWorktreeTitle': 'Create a new worktree',
  'action.createWorktreeHint': 'A new branch will be created from the selected base.',
  'action.createWorktreeBaseLabel': 'Base branch',
  'action.createWorktreeBasePlaceholder': 'Pick a branch',
  'action.createWorktreeBranchLabel': 'New branch name',
  'action.createWorktreeBranchPlaceholder': 'feat/feature-name',
  'action.createWorktreePathLabel': 'Worktree path (optional)',
  'action.createWorktreePathDisabledHint': 'Enter a branch name to auto-fill the path.',
  'action.createWorktreeBaseCurrent': 'current',
  'action.createWorktreeConfirm': 'Create worktree',
  'action.menu': 'Actions',
  'action.refresh': 'Refresh',
  'action.refreshTitle': 'git branch · git status · git log',

  // ---- Errors / banners ---------------------------------------------------
  'error.notGitRepo': 'Not a git repository',
  'error.failedReadRepo': 'Failed to read repository',
  'error.openGithubNoOrigin': 'No origin remote',
  'error.invalidPath': 'Invalid path',
  'error.invalidWorktreePath': 'Invalid worktree path',
  'error.invalidArguments': 'Invalid arguments',
  'error.networkOpInProgress': 'Another git network operation is already running.',
  'error.unknown': 'Unknown error',
  'error.cannotDeleteCurrentBranch': 'Cannot delete the current branch',
  'error.cannotDeleteProtectedBranch': 'Cannot delete a protected branch',
  'error.cannotDeleteCheckedOutBranch': 'Cannot delete a branch checked out in a worktree',
  'error.worktreeNotFoundForBranch': 'Worktree not found for branch',
  'error.cannotRemoveMainWorktree': 'Cannot remove the main worktree',
  'error.cannotRemoveDirtyWorktree': 'Worktree has uncommitted changes — commit or discard them first',
  'error.cannotRemoveLockedWorktree': 'Worktree is locked — unlock it before removing',
  'error.cannotRemoveUnpushedWorktree': 'Branch has unpushed commits — push first, or untick "Also delete branch"',
  'error.ghosttyNotInstalled': 'Ghostty not installed',
  'error.renderCrashTitle': 'Something broke while rendering this view',
  'error.renderCrashUnknown': 'Unknown render error.',
  'error.tryAgain': 'Try again',
  'error.back': 'Back (Esc)',
  'error.settingsWriteTitle': 'Failed to save settings',

  // ---- Settings panel -----------------------------------------------------
  'settings.title': 'Settings',
  'settings.appearance': 'Appearance',
  'settings.theme.auto': 'Auto',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.lang': 'Language',
  'settings.lang.auto': 'Auto',
  'settings.lang.en': 'English',
  'settings.lang.zh': '中文',
  'settings.lang.ko': '한국어',
  'settings.lang.ja': '日本語',
  'settings.fetch': 'Auto-fetch',
  'settings.fetchHint': 'Background `git fetch` for the active repository. Disable on slow networks.',
  'settings.fetch.off': 'Off',
  'settings.fetch.30s': '30 sec',
  'settings.fetch.1m': '1 min',
  'settings.fetch.5m': '5 min',
  'settings.fetch.15m': '15 min',

  // ---- Help overlay -------------------------------------------------------
  'help.title': 'Keyboard shortcuts',
  'help.section.nav': 'Navigation',
  'help.section.views': 'Views',
  'help.section.actions': 'Actions',
  'help.row.nextBranch': 'Next branch / commit',
  'help.row.prevBranch': 'Previous branch / commit',
  'help.row.nextRepo': 'Next repository',
  'help.row.prevRepo': 'Previous repository',
  'help.row.viewBranches': 'Branches',
  'help.row.viewStatus': 'Status',
  'help.row.viewLog': 'Log',
  'help.row.checkout': 'Checkout branch / open commit',
  'help.row.openRepo': 'Open repository',
  'help.row.activateWindow': 'Show Goblin window',
  'help.row.closeRepo': 'Close current tab',
  'help.row.refresh': 'Refresh',
  'help.row.settings': 'Settings',
  'help.row.thisHelp': 'This help',
  'help.row.dismiss': 'Dismiss overlay',

  // ---- Generic dialog -----------------------------------------------------
  'dialog.cancel': 'Cancel',
  'dialog.close': 'Close (Esc)',

  // ---- Commit detail ------------------------------------------------------
  'commit.parent': 'parent',
  'commit.parents': 'parents',
  'commit.filesChanged': '{n} file changed',
  'commit.filesChangedPlural': '{n} files changed',
  'commit.empty': 'No file changes (merge or empty commit).',
  'commit.binary': 'binary',
} as const

export type DictKey = keyof typeof en
