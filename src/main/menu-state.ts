import type { LangPref } from '#/shared/api-types.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'

export interface MenuRuntimeState {
  recentWorkspaces: WorkspaceSessionEntry[]
  shortcutsDisabled: boolean
  langPref: LangPref
}

const DEFAULT_MENU_RUNTIME_STATE: MenuRuntimeState = {
  recentWorkspaces: [],
  shortcutsDisabled: false,
  langPref: 'auto',
}

let state: MenuRuntimeState = { ...DEFAULT_MENU_RUNTIME_STATE }

function nextMenuRuntimeState(base: MenuRuntimeState, next: Partial<MenuRuntimeState>): MenuRuntimeState {
  return {
    recentWorkspaces: next.recentWorkspaces ? [...next.recentWorkspaces] : [...base.recentWorkspaces],
    shortcutsDisabled: next.shortcutsDisabled ?? base.shortcutsDisabled,
    langPref: next.langPref ?? base.langPref,
  }
}

export function initializeMenuRuntimeState(next: Partial<MenuRuntimeState>): void {
  state = nextMenuRuntimeState(DEFAULT_MENU_RUNTIME_STATE, next)
}

export function readMenuRuntimeState(): MenuRuntimeState {
  return {
    recentWorkspaces: [...state.recentWorkspaces],
    shortcutsDisabled: state.shortcutsDisabled,
    langPref: state.langPref,
  }
}

export function applyMenuRuntimeState(next: Partial<MenuRuntimeState>): void {
  state = nextMenuRuntimeState(state, next)
}
