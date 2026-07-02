import type { ReposSet, ReposStore } from '#/web/stores/repos/types.ts'

type TabOpenerActions = Pick<ReposStore, 'setTabOpener' | 'clearTabOpener'>

// Opener identities (e.g. `workspace-pane:changes`) are shared string
// constants across *every* repo/branch's static tabs, unlike terminal
// identities which embed a globally-unique session id. Recording openers in
// a single flat map would let one repo's "changes" tab bleed its opener
// into an unrelated repo's "changes" tab. Scoping by `${repoId}\0${branchName}`
// keeps each tab strip's opener bookkeeping independent.
export function tabOpenerScopeKey(repoId: string, branchName: string): string {
  return `${repoId}\0${branchName}`
}

export function createTabOpenerActions(set: ReposSet): TabOpenerActions {
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
