import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { RouteLocationNormalized } from 'vue-router'
import { initialWorkspaceRouteSlugFromStore, routeStringParam } from '#/web/app/navigation/route-model.ts'
import { workspaceIdFromSlug } from '#/web/app/navigation/workspace-route-slugs.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

export function useAppRouteAdmission(route: RouteLocationNormalized) {
  const router = useRouter()
  const workspaceState = useStoreSelector(
    workspacesStore,
    (state) => ({
      restoredWorkspaceId: state.restoredWorkspaceId,
      workspaceOrder: state.workspaceOrder,
      workspaces: state.workspaces,
      workspaceMembershipReady: state.workspaceMembershipReady,
    }),
    (left, right) =>
      left.restoredWorkspaceId === right.restoredWorkspaceId &&
      left.workspaceOrder === right.workspaceOrder &&
      left.workspaces === right.workspaces &&
      left.workspaceMembershipReady === right.workspaceMembershipReady,
  )
  const routeAdmitted = computed(() => {
    const workspaceSlug = routeStringParam(route.params.workspaceSlug)
    if (!workspaceSlug) return true
    const workspaceId = workspaceIdFromSlug(workspaceSlug)
    const workspace = workspaceId ? workspaceState.value.workspaces[workspaceId] : null
    if (!workspace) return true
    if (routeRequiresGitCapability(route)) return workspace.capability.kind !== 'filesystem'
    if (routeRequiresFilesystemCapability(route)) return workspace.capability.kind !== 'git'
    return true
  })
  const admittedPath = computed(() => {
    if (route.name === 'home') {
      const workspaceSlug = initialWorkspaceRouteSlugFromStore(workspaceState.value)
      return workspaceSlug ? `/workspace/${workspaceSlug}/dashboard` : null
    }

    const workspaceSlug = routeStringParam(route.params.workspaceSlug)
    return workspaceSlug && !routeAdmitted.value ? `/workspace/${workspaceSlug}/dashboard` : null
  })

  watch(
    admittedPath,
    (path) => {
      if (path && path !== route.path) void router.replace(path)
    },
    { immediate: true },
  )
  return routeAdmitted
}

function routeRequiresGitCapability(route: RouteLocationNormalized): boolean {
  const name = typeof route.name === 'string' ? route.name : ''
  return (
    name === 'workspace-new-worktree' || name.startsWith('workspace-branch') || name.startsWith('workspace-worktree')
  )
}

function routeRequiresFilesystemCapability(route: RouteLocationNormalized): boolean {
  const name = typeof route.name === 'string' ? route.name : ''
  return name.startsWith('workspace-root')
}
