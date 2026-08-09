import { beforeEach, describe, expect, test, vi } from 'vitest'
import { computed } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Router, RouterHistory } from 'vue-router'
import { renderComposableInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  consumeAppHistoryPresentationAction,
  createAppHistoryPresentationHistory,
  installAppHistoryPresentationObserver,
  requireAppHistoryPresentation,
  useAppHistoryPresentationObserver,
} from '#/web/app-history-presentation.ts'
import { appNavigationState, resetAppNavigationForTest } from '#/web/app-navigation-lifecycle.ts'
import { runOwnedAppNavigation } from '#/web/app-route-commit.ts'
import { navigateAppRoute } from '#/web/app-router-location.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { useWorkspaceNavigationHistory } from '#/web/workspace-navigation-history.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///test-workspace')

beforeEach(() => {
  resetAppNavigationForTest()
  resetWorkspacesStore()
})

describe('app history presentation', () => {
  test('starts a fresh presentation without mutating the current history entry', () => {
    const rawHistory = createMemoryHistory()
    rawHistory.replace('/restored', { applicationState: 'preserved' })
    const initialState = rawHistory.state

    const history = createAppHistoryPresentationHistory(rawHistory)

    expect(history.location).toBe('/restored')
    expect(history.state).toBe(initialState)
    expect(requireAppHistoryPresentation(history)).toEqual({
      settlementId: 1,
      action: { type: 'REPLACE' },
    })
  })

  test('keeps the final PUSH bound to its committed entry across rapid navigation cancellation', async () => {
    const { history, router } = await createRouterHarness()
    const failedHrefs: string[] = []
    router.afterEach((to, _from, failure) => {
      if (failure) failedHrefs.push(to.fullPath)
    })

    expect(runOwnedPush(router, '/a')).toBe(true)
    queueMicrotask(() => runOwnedPush(router, '/b'))
    queueMicrotask(() => queueMicrotask(() => runOwnedPush(router, '/c')))

    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/c'))
    expect(failedHrefs).toEqual(['/a', '/b'])
    expect(requireAppHistoryPresentation(history).action).toEqual({ type: 'PUSH' })

    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/'))
  })

  test('does not let a cancelled direct replacement clear a later PUSH', async () => {
    const { history, router } = await createRouterHarness()

    void router.replace('/a')
    expect(runOwnedPush(router, '/b')).toBe(true)

    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/b'))
    expect(requireAppHistoryPresentation(history).action).toEqual({ type: 'PUSH' })

    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/'))
  })

  test('preserves the previous workspace entry when a superseding PUSH commits', async () => {
    const { history, router } = await createWorkspaceRouterHarness()
    const workspace = emptyWorkspace(WORKSPACE_ID, 'runtime-test')
    workspacesStore.setState({ workspaces: { [WORKSPACE_ID]: workspace } })
    renderComposableInJsdom(
      () => {
        useAppHistoryPresentationObserver()
        const routeContext = computed(() => {
          const fullPath = router.currentRoute.value.fullPath
          if (fullPath.endsWith('/tab/status')) {
            return {
              kind: 'workspace-root' as const,
              workspaceId: WORKSPACE_ID,
              workspacePaneRoute: { kind: 'static' as const, tab: 'status' as const },
            }
          }
          if (fullPath.endsWith('/terminal/terminal-test')) {
            return {
              kind: 'workspace-root' as const,
              workspaceId: WORKSPACE_ID,
              workspacePaneRoute: { kind: 'terminal' as const, terminalSessionId: 'terminal-test' },
            }
          }
          return null
        })
        useWorkspaceNavigationHistory({ routeContext })
      },
      { global: { plugins: [router] } },
    )
    await vi.waitFor(() => {
      expect(workspacesStore.getState().navigationHistoryByWorkspace[WORKSPACE_ID]?.current?.route).toMatchObject({
        kind: 'workspace-root',
        workspacePaneTab: 'status',
      })
    })

    expect(runOwnedPush(router, '/intermediate')).toBe(true)
    queueMicrotask(() => runOwnedPush(router, '/workspace/root/terminal/terminal-test'))

    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/workspace/root/terminal/terminal-test'))
    expect(requireAppHistoryPresentation(history).action).toEqual({ type: 'PUSH' })
    await vi.waitFor(() => {
      const workspaceHistory = workspacesStore.getState().navigationHistoryByWorkspace[WORKSPACE_ID]
      expect(workspaceHistory?.current?.route).toMatchObject({
        kind: 'workspace-root',
        workspacePaneTab: 'terminal',
        terminalSessionId: 'terminal-test',
      })
      expect(workspaceHistory?.backStack).toHaveLength(1)
      expect(workspaceHistory?.backStack[0]?.route).toMatchObject({
        kind: 'workspace-root',
        workspacePaneTab: 'status',
      })
    })
  })

  test('records direct replacements at the same committed history boundary', async () => {
    const { history, router } = await createRouterHarness()
    const initialPresentation = requireAppHistoryPresentation(history)
    expect(initialPresentation.action).toEqual({ type: 'REPLACE' })

    await router.replace('/a')

    const presentation = requireAppHistoryPresentation(history)
    expect(presentation.settlementId).toBeGreaterThan(initialPresentation.settlementId)
    expect(presentation.action).toEqual({ type: 'REPLACE' })
  })

  test('consumes each committed action once across projection owner lifecycles', async () => {
    const { history, router } = await createRouterHarness()

    expect(consumeAppHistoryPresentationAction(history)).toEqual({ type: 'REPLACE' })
    expect(consumeAppHistoryPresentationAction(history)).toBeNull()

    await router.push('/a')

    expect(consumeAppHistoryPresentationAction(history)).toEqual({ type: 'PUSH' })
    expect(consumeAppHistoryPresentationAction(history)).toBeNull()
  })

  test('does not publish mutations that the underlying history rejects', () => {
    const rawHistory = createMemoryHistory()
    const history = createAppHistoryPresentationHistory(rawHistory)
    const initialPresentation = requireAppHistoryPresentation(history)
    const push = vi.spyOn(rawHistory, 'push').mockImplementation(() => {
      throw new Error('push rejected')
    })

    expect(() => history.push('/a')).toThrow('push rejected')
    expect(requireAppHistoryPresentation(history)).toEqual(initialPresentation)
    push.mockRestore()

    const replace = vi.spyOn(rawHistory, 'replace').mockImplementation(() => {
      throw new Error('replace rejected')
    })
    expect(() => history.replace('/a')).toThrow('replace rejected')
    expect(requireAppHistoryPresentation(history)).toEqual(initialPresentation)
    replace.mockRestore()
  })

  test('does not publish a new settlement for a same-location navigation that Vue Router rejects', async () => {
    const { history, router } = await createRouterHarness()
    await router.push('/a')
    const pushedPresentation = requireAppHistoryPresentation(history)

    await router.replace('/a')

    expect(requireAppHistoryPresentation(history)).toEqual(pushedPresentation)

    await router.replace({ path: '/a', force: true })

    const forcedPresentation = requireAppHistoryPresentation(history)
    expect(forcedPresentation.settlementId).not.toBe(pushedPresentation.settlementId)
    expect(forcedPresentation.action).toEqual({ type: 'REPLACE' })
  })

  test('binds back, forward, and multi-entry traversal actions to their target entries', async () => {
    const { history, router } = await createRouterHarness()
    await router.push('/a')
    await router.push('/b')

    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/a'))
    const backPresentation = requireAppHistoryPresentation(history)
    expect(backPresentation.action).toEqual({ type: 'BACK' })

    router.forward()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/b'))
    const forwardPresentation = requireAppHistoryPresentation(history)
    expect(forwardPresentation.settlementId).toBeGreaterThan(backPresentation.settlementId)
    expect(forwardPresentation.action).toEqual({ type: 'FORWARD' })

    history.go(-2)
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/'))
    const goPresentation = requireAppHistoryPresentation(history)
    expect(goPresentation.settlementId).toBeGreaterThan(forwardPresentation.settlementId)
    expect(goPresentation.action).toEqual({ type: 'GO', index: -2 })
  })

  test('keeps the presented entry unchanged when a traversal guard rejects Back', async () => {
    const { history, router } = await createRouterHarness()
    await router.push('/a')
    const aPresentation = requireAppHistoryPresentation(history)
    const removeGuard = router.beforeEach((to) => to.path !== '/')
    const rejected = Promise.withResolvers<void>()
    const removeAfterEach = router.afterEach((_to, _from, failure) => {
      if (failure) rejected.resolve()
    })

    router.back()
    await rejected.promise
    removeAfterEach()
    expect(router.currentRoute.value.fullPath).toBe('/a')
    expect(requireAppHistoryPresentation(history)).toEqual(aPresentation)

    removeGuard()
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/'))
    const backPresentation = requireAppHistoryPresentation(history)
    expect(backPresentation.settlementId).toBeGreaterThan(aPresentation.settlementId)
    expect(backPresentation.action).toEqual({ type: 'BACK' })
  })

  test('assigns an entry owner when traversing to a legacy history entry without app metadata', async () => {
    const rawHistory = createMemoryHistory()
    rawHistory.replace('/', {})
    rawHistory.push('/legacy', {})
    const history = createAppHistoryPresentationHistory(rawHistory)
    const router = createRouter({
      history,
      routes: [
        { path: '/', component: { render: () => null } },
        { path: '/legacy', component: { render: () => null } },
      ],
    })
    installAppHistoryPresentationObserver(router)
    await router.push('/legacy')
    await router.isReady()

    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/'))
    const presentation = requireAppHistoryPresentation(history)
    expect(presentation.action).toEqual({ type: 'BACK' })

    router.forward()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/legacy'))
    expect(requireAppHistoryPresentation(history).action).toEqual({ type: 'FORWARD' })
  })

  test('starts a fresh REPLACE settlement when an entry is restored into a new runtime', async () => {
    const first = await createRouterHarness()
    await first.router.push('/a')
    const previousRuntimePresentation = requireAppHistoryPresentation(first.history)
    const restoredState = { ...first.history.state }

    const restoredRawHistory = createMemoryHistory()
    restoredRawHistory.replace('/a', restoredState)
    const restoredHistory = createAppHistoryPresentationHistory(restoredRawHistory)

    expect(previousRuntimePresentation.action).toEqual({ type: 'PUSH' })
    expect(requireAppHistoryPresentation(restoredHistory)).toEqual({
      settlementId: 1,
      action: { type: 'REPLACE' },
    })
  })

  test('releases its presentation owner when history is destroyed', async () => {
    const { history } = await createRouterHarness()

    history.destroy()

    expect(() => requireAppHistoryPresentation(history)).toThrow(
      'Vue Router must use the app history presentation adapter',
    )
  })
})

async function createRouterHarness(): Promise<{ history: RouterHistory; router: Router }> {
  const history = createAppHistoryPresentationHistory(createMemoryHistory())
  const router = createRouter({
    history,
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/a', component: { render: () => null } },
      { path: '/b', component: { render: () => null } },
      { path: '/c', component: { render: () => null } },
    ],
  })
  installAppHistoryPresentationObserver(router)
  await router.push('/')
  await router.isReady()
  return { history, router }
}

async function createWorkspaceRouterHarness(): Promise<{ history: RouterHistory; router: Router }> {
  const history = createAppHistoryPresentationHistory(createMemoryHistory())
  const router = createRouter({
    history,
    routes: [
      { path: '/workspace/root/tab/status', component: { render: () => null } },
      { path: '/workspace/root/terminal/terminal-test', component: { render: () => null } },
      { path: '/intermediate', component: { render: () => null } },
    ],
  })
  await router.push('/workspace/root/tab/status')
  await router.isReady()
  return { history, router }
}

function runOwnedPush(router: Router, path: string): boolean {
  return runOwnedAppNavigation({
    targetHref: path,
    currentHref: router.currentRoute.value.fullPath,
    navigate: async (navigationGeneration) => {
      await navigateAppRoute(router, path, false, appNavigationState({}, navigationGeneration))
    },
  })
}
