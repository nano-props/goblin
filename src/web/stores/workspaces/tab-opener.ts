import type { WorkspacesSet, WorkspacesStore } from '#/web/stores/workspaces/types.ts'
import {
  workspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'

type TabOpenerActions = Pick<WorkspacesStore, 'setTabOpener' | 'clearTabOpener'>

// Opener identities (e.g. `workspace-pane:changes`) are shared string
// constants across *every* workspace pane target, unlike terminal identities
// which embed a globally-unique session id. The opener scope must therefore be
// the same target identity used by the tab-list projection and selected-tab
// preference. Worktree-backed branches share the worktree target; branch-only
// panes use the branch target.
export function tabOpenerScopeKey(target: WorkspacePaneTabsTarget): string {
  return workspacePaneTabsTargetIdentityKey(target)
}

export function createTabOpenerActions(set: WorkspacesSet): TabOpenerActions {
  return {
    setTabOpener(scopeKey: string, childIdentity: string, openerIdentity: string) {
      set((s) => {
        const scope = s.tabOpenerIdentityByScope[scopeKey]
        if (scope?.[childIdentity] === openerIdentity) return s
        return {
          tabOpenerIdentityByScope: {
            ...s.tabOpenerIdentityByScope,
            [scopeKey]: { ...scope, [childIdentity]: openerIdentity },
          },
        }
      })
    },

    clearTabOpener(scopeKey: string, childIdentity: string) {
      set((s) => {
        const scope = s.tabOpenerIdentityByScope[scopeKey]
        if (!scope || !(childIdentity in scope)) return s
        const nextScope = { ...scope }
        delete nextScope[childIdentity]
        const tabOpenerIdentityByScope = { ...s.tabOpenerIdentityByScope }
        if (Object.keys(nextScope).length === 0) delete tabOpenerIdentityByScope[scopeKey]
        else tabOpenerIdentityByScope[scopeKey] = nextScope
        return { tabOpenerIdentityByScope }
      })
    },
  }
}
