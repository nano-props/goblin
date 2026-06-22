import type { LangPref } from '#/shared/api-types.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'

export interface MenuRuntimeState {
  recentRepos: RepoSessionEntry[]
  shortcutsDisabled: boolean
  langPref: LangPref
}

const DEFAULT_MENU_RUNTIME_STATE: MenuRuntimeState = {
  recentRepos: [],
  shortcutsDisabled: false,
  langPref: 'auto',
}

let state: MenuRuntimeState = { ...DEFAULT_MENU_RUNTIME_STATE }

function nextMenuRuntimeState(base: MenuRuntimeState, next: Partial<MenuRuntimeState>): MenuRuntimeState {
  return {
    recentRepos: next.recentRepos ? [...next.recentRepos] : [...base.recentRepos],
    shortcutsDisabled: next.shortcutsDisabled ?? base.shortcutsDisabled,
    langPref: next.langPref ?? base.langPref,
  }
}

export function initializeMenuRuntimeState(next: Partial<MenuRuntimeState>): void {
  state = nextMenuRuntimeState(DEFAULT_MENU_RUNTIME_STATE, next)
}

export function readMenuRuntimeState(): MenuRuntimeState {
  return {
    recentRepos: [...state.recentRepos],
    shortcutsDisabled: state.shortcutsDisabled,
    langPref: state.langPref,
  }
}

export function applyMenuRuntimeState(next: Partial<MenuRuntimeState>): void {
  state = nextMenuRuntimeState(state, next)
}
