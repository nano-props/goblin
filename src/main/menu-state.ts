import { DEFAULT_WORKSPACE_LAYOUT, normalizeWorkspaceLayout, type WorkspaceLayout } from '#/shared/workspace-layout.ts'
import type { LangPref } from '#/shared/rpc.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'

export interface MenuRuntimeState {
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

function nextMenuRuntimeState(base: MenuRuntimeState, next: Partial<MenuRuntimeState>): MenuRuntimeState {
  return {
    recentRepos: next.recentRepos ? [...next.recentRepos] : [...base.recentRepos],
    shortcutsDisabled: next.shortcutsDisabled ?? base.shortcutsDisabled,
    swapCloseShortcuts: next.swapCloseShortcuts ?? base.swapCloseShortcuts,
    langPref: next.langPref ?? base.langPref,
    workspaceLayout: next.workspaceLayout === undefined ? base.workspaceLayout : normalizeWorkspaceLayout(next.workspaceLayout),
  }
}

export function initializeMenuRuntimeState(next: Partial<MenuRuntimeState>): void {
  state = nextMenuRuntimeState(DEFAULT_MENU_RUNTIME_STATE, next)
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

export function applyMenuRuntimeState(next: Partial<MenuRuntimeState>): void {
  state = nextMenuRuntimeState(state, next)
}

export function setMenuWorkspaceLayout(workspaceLayout: WorkspaceLayout): void {
  applyMenuRuntimeState({ workspaceLayout })
}
