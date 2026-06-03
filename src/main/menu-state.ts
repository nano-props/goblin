import { DEFAULT_WORKSPACE_LAYOUT, normalizeWorkspaceLayout, type WorkspaceLayout } from '#/shared/workspace-layout.ts'
import type { LangPref } from '#/shared/rpc.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'

interface MenuRuntimeState {
  recentRepos: RepoSessionEntry[]
  shortcutsDisabled: boolean
  swapCloseShortcuts: boolean
  langPref: LangPref
  workspaceLayout: WorkspaceLayout
}

const DEFAULT_MENU_RUNTIME_STATE: MenuRuntimeState = {
  recentRepos: [],
  shortcutsDisabled: false,
  swapCloseShortcuts: false,
  langPref: 'auto',
  workspaceLayout: DEFAULT_WORKSPACE_LAYOUT,
}

let state: MenuRuntimeState = { ...DEFAULT_MENU_RUNTIME_STATE }

export function initializeMenuRuntimeState(next: Partial<MenuRuntimeState>): void {
  state = {
    recentRepos: next.recentRepos ? [...next.recentRepos] : [...DEFAULT_MENU_RUNTIME_STATE.recentRepos],
    shortcutsDisabled: next.shortcutsDisabled ?? DEFAULT_MENU_RUNTIME_STATE.shortcutsDisabled,
    swapCloseShortcuts: next.swapCloseShortcuts ?? DEFAULT_MENU_RUNTIME_STATE.swapCloseShortcuts,
    langPref: next.langPref ?? DEFAULT_MENU_RUNTIME_STATE.langPref,
    workspaceLayout: normalizeWorkspaceLayout(next.workspaceLayout),
  }
}

export function readMenuRuntimeState(): MenuRuntimeState {
  return {
    recentRepos: [...state.recentRepos],
    shortcutsDisabled: state.shortcutsDisabled,
    swapCloseShortcuts: state.swapCloseShortcuts,
    langPref: state.langPref,
    workspaceLayout: state.workspaceLayout,
  }
}

export function setMenuRecentRepos(recentRepos: RepoSessionEntry[]): void {
  state.recentRepos = [...recentRepos]
}

export function setMenuShortcutsDisabled(shortcutsDisabled: boolean): void {
  state.shortcutsDisabled = shortcutsDisabled
}

export function setMenuSwapCloseShortcuts(swapCloseShortcuts: boolean): void {
  state.swapCloseShortcuts = swapCloseShortcuts
}

export function setMenuLangPref(langPref: LangPref): void {
  state.langPref = langPref
}

export function setMenuWorkspaceLayout(workspaceLayout: WorkspaceLayout): void {
  state.workspaceLayout = normalizeWorkspaceLayout(workspaceLayout)
}
