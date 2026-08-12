// @vitest-environment jsdom

import { seedRepoWithReadModelForTest, resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { HistoryState, RouteLocationRaw, RouteRecordRaw } from 'vue-router'

import { useAppRouteNavigation } from '#/web/app-route-navigation.ts'
import { observeAppHistoryNavigation, resetAppNavigationForTest } from '#/web/app-navigation-lifecycle.ts'
import { workspaceSlugFromId, worktreeSlugFromPath } from '#/web/workspace-route-slugs.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { FilesystemWorkspacePaneRouteTarget } from '#/web/app-route-navigation.ts'
import { renderComposableInJsdom } from '#/test-utils/render.tsx'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/filesystem-route-navigation-workspace')
const WORKTREE_PATH = '/tmp/filesystem-route-navigation-worktree'
const TERMINAL_SESSION_ID = 'term-111111111111111111111'

describe('filesystem workspace pane route navigation', () => {
  beforeEach(() => {
    resetAppNavigationForTest()
    resetWorkspacesStore()
    seedRepoWithReadModelForTest({ id: WORKSPACE_ID, branches: [], currentBranchName: null })
  })

  test.each([
    ['workspace root', { kind: 'workspace-root' as const, workspaceId: WORKSPACE_ID }],
    ['detached worktree', { kind: 'git-worktree' as const, workspaceId: WORKSPACE_ID, worktreePath: WORKTREE_PATH }],
  ])('commits bare, static, and terminal routes through the %s operation boundary', async (_label, target) => {
    for (const route of [
      null,
      { kind: 'static' as const, tab: 'files' as const },
      { kind: 'terminal' as const, terminalSessionId: TERMINAL_SESSION_ID },
    ] satisfies WorkspacePaneRouteTarget[]) {
      resetAppNavigationForTest()
      const rootHref = filesystemRootHref(target)
      const sourceRoute = { kind: 'invalid-static' as const, tabKey: 'missing tab' }
      const harness = await routeNavigationHarness(`${rootHref}/tab/${encodeURIComponent(sourceRoute.tabKey)}`)
      const { result, unmount } = renderComposableInJsdom(() => useAppRouteNavigation(), {
        global: { plugins: [harness.router] },
      })
      let committed = false

      await flushTestUpdates(async () => {
        committed = await result.value.commitFilesystemWorkspacePaneRoute(target, route, {
          replace: true,
          routePrecondition: { kind: 'exact-route', route: sourceRoute },
        })
      })

      expect(committed).toBe(true)
      expect(harness.navigate).toHaveBeenCalledOnce()
      expect(harness.navigate).toHaveBeenCalledWith(expect.objectContaining({ replace: true }))
      expect(harness.currentHref()).toBe(filesystemRouteHref(target, route))
      unmount()
    }
  })

  test.each([
    ['workspace root', { kind: 'workspace-root' as const, workspaceId: WORKSPACE_ID }],
    ['detached worktree', { kind: 'git-worktree' as const, workspaceId: WORKSPACE_ID, worktreePath: WORKTREE_PATH }],
  ])('rejects a malformed extra-segment source route for the %s target', async (_label, target) => {
    const harness = await routeNavigationHarness(`${filesystemRootHref(target)}/tab/files/extra`)
    const { result } = renderComposableInJsdom(() => useAppRouteNavigation(), {
      global: { plugins: [harness.router] },
    })
    const onAbandon = vi.fn()

    await expect(
      result.value.commitFilesystemWorkspacePaneRoute(
        target,
        { kind: 'static', tab: 'files' },
        {
          routePrecondition: { kind: 'current-workspace-target' },
          onAbandon,
        },
      ),
    ).resolves.toBe(false)
    expect(harness.navigate).not.toHaveBeenCalled()
    expect(onAbandon).toHaveBeenCalledOnce()
  })

  test.each([
    ['workspace root', { kind: 'workspace-root' as const, workspaceId: WORKSPACE_ID }],
    ['detached worktree', { kind: 'git-worktree' as const, workspaceId: WORKSPACE_ID, worktreePath: WORKTREE_PATH }],
  ])('does not replace a newer route from a stale reconciliation for the %s target', async (_label, target) => {
    const currentRoute = { kind: 'static' as const, tab: 'files' as const }
    const staleSourceRoute = { kind: 'terminal' as const, terminalSessionId: TERMINAL_SESSION_ID }
    const harness = await routeNavigationHarness(filesystemRouteHref(target, currentRoute))
    const { result } = renderComposableInJsdom(() => useAppRouteNavigation(), {
      global: { plugins: [harness.router] },
    })
    const onAbandon = vi.fn()

    await expect(
      result.value.commitFilesystemWorkspacePaneRoute(target, null, {
        replace: true,
        routePrecondition: { kind: 'exact-route', route: staleSourceRoute },
        onAbandon,
      }),
    ).resolves.toBe(false)

    expect(harness.navigate).not.toHaveBeenCalled()
    expect(harness.currentHref()).toBe(filesystemRouteHref(target, currentRoute))
    expect(onAbandon).toHaveBeenCalledOnce()
  })
})

function filesystemRootHref(target: FilesystemWorkspacePaneRouteTarget): string {
  const workspaceSlug = workspaceSlugFromId(target.workspaceId)
  return target.kind === 'workspace-root'
    ? `/workspace/${workspaceSlug}/root`
    : `/workspace/${workspaceSlug}/worktree/${worktreeSlugFromPath(target.worktreePath)}`
}

function filesystemRouteHref(target: FilesystemWorkspacePaneRouteTarget, route: WorkspacePaneRouteTarget): string {
  const rootHref = filesystemRootHref(target)
  if (route === null) return rootHref
  return route.kind === 'static' ? `${rootHref}/tab/${route.tab}` : `${rootHref}/terminal/${route.terminalSessionId}`
}

async function routeNavigationHarness(initialHref: string) {
  const history = createMemoryHistory()
  const router = createRouter({ history, routes: filesystemTestRoutes })
  await router.push(initialHref)
  await router.isReady()

  let action: 'PUSH' | 'REPLACE' = 'PUSH'
  const navigate = vi.fn((input: { target: RouteLocationRaw; replace: boolean }) => input)
  const push = router.push.bind(router)
  const replace = router.replace.bind(router)
  router.push = async (target) => {
    action = 'PUSH'
    navigate({ target, replace: false })
    return await push(target)
  }
  router.replace = async (target) => {
    action = 'REPLACE'
    navigate({ target, replace: true })
    return await replace(target)
  }
  router.afterEach((to, _from, failure) => {
    if (failure) return
    observeAppHistoryNavigation({ href: to.fullPath, state: history.state as HistoryState, action: { type: action } })
  })

  return {
    currentHref: () => router.currentRoute.value.fullPath,
    navigate,
    router,
  }
}

const filesystemTestRoutes: RouteRecordRaw[] = [
  { path: '/workspace/:workspaceSlug/root', name: 'workspace-root', component: { render: () => null } },
  {
    path: '/workspace/:workspaceSlug/root/tab/:tabKey',
    name: 'workspace-root-tab',
    component: { render: () => null },
  },
  {
    path: '/workspace/:workspaceSlug/root/terminal/:terminalSessionId',
    name: 'workspace-root-terminal',
    component: { render: () => null },
  },
  {
    path: '/workspace/:workspaceSlug/worktree/:worktreeSlug',
    name: 'workspace-worktree',
    component: { render: () => null },
  },
  {
    path: '/workspace/:workspaceSlug/worktree/:worktreeSlug/tab/:tabKey',
    name: 'workspace-worktree-tab',
    component: { render: () => null },
  },
  {
    path: '/workspace/:workspaceSlug/worktree/:worktreeSlug/terminal/:terminalSessionId',
    name: 'workspace-worktree-terminal',
    component: { render: () => null },
  },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: { render: () => null } },
]
