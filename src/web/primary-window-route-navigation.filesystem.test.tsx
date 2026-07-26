// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { HistoryState } from '@tanstack/history'

const routerMock = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useRouter: () => routerMock.current }
})

import { usePrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import {
  observePrimaryWindowHistoryNavigation,
  resetPrimaryWindowNavigationForTest,
} from '#/web/primary-window-navigation-lifecycle.ts'
import { workspaceSlugFromId, worktreeSlugFromPath } from '#/web/workspace-route-slugs.ts'
import { resetWorkspacesStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { FilesystemWorkspacePaneRouteTarget } from '#/web/primary-window-route-navigation.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/filesystem-route-navigation-workspace')
const WORKTREE_PATH = '/tmp/filesystem-route-navigation-worktree'
const TERMINAL_SESSION_ID = 'term-111111111111111111111'

describe('filesystem workspace pane route navigation', () => {
  beforeEach(() => {
    resetPrimaryWindowNavigationForTest()
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
      resetPrimaryWindowNavigationForTest()
      const rootHref = filesystemRootHref(target)
      const sourceRoute = { kind: 'invalid-static' as const, tabKey: 'missing tab' }
      const harness = routeNavigationHarness(`${rootHref}/tab/${encodeURIComponent(sourceRoute.tabKey)}`)
      routerMock.current = harness.router
      const { result, unmount } = renderHook(() => usePrimaryWindowRouteNavigation())
      let committed = false

      await act(async () => {
        committed = await result.current.commitFilesystemWorkspacePaneRoute(target, route, {
          replace: true,
          routePrecondition: { kind: 'exact-route', route: sourceRoute },
        })
      })

      expect(committed).toBe(true)
      expect(harness.navigate).toHaveBeenCalledOnce()
      expect(harness.navigate).toHaveBeenCalledWith(expect.objectContaining({ replace: true, ignoreBlocker: true }))
      expect(harness.currentHref()).toBe(filesystemRouteHref(target, route))
      unmount()
    }
  })

  test.each([
    ['workspace root', { kind: 'workspace-root' as const, workspaceId: WORKSPACE_ID }],
    ['detached worktree', { kind: 'git-worktree' as const, workspaceId: WORKSPACE_ID, worktreePath: WORKTREE_PATH }],
  ])('rejects a malformed extra-segment source route for the %s target', async (_label, target) => {
    const harness = routeNavigationHarness(`${filesystemRootHref(target)}/tab/files/extra`)
    routerMock.current = harness.router
    const { result } = renderHook(() => usePrimaryWindowRouteNavigation())
    const onAbandon = vi.fn()

    await expect(
      result.current.commitFilesystemWorkspacePaneRoute(
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
    const harness = routeNavigationHarness(filesystemRouteHref(target, currentRoute))
    routerMock.current = harness.router
    const { result } = renderHook(() => usePrimaryWindowRouteNavigation())
    const onAbandon = vi.fn()

    await expect(
      result.current.commitFilesystemWorkspacePaneRoute(target, null, {
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

function routeNavigationHarness(initialHref: string) {
  const location: { href: string; state: HistoryState } = { href: initialHref, state: {} }
  const navigate = vi.fn(async (input: RouteNavigationInput) => {
    const href = buildHref(input)
    const state = input.state?.(location.state) ?? location.state
    location.href = href
    location.state = state
    observePrimaryWindowHistoryNavigation({
      href,
      state,
      action: { type: input.replace ? 'REPLACE' : 'PUSH' },
    })
  })
  return {
    currentHref: () => location.href,
    navigate,
    router: {
      state: { location },
      buildLocation: (input: RouteLocationInput) => ({ href: buildHref(input) }),
      navigate,
      history: { push: vi.fn() },
    },
  }
}

interface RouteLocationInput {
  to: string
  params?: Record<string, string>
}

interface RouteNavigationInput extends RouteLocationInput {
  replace?: boolean
  ignoreBlocker?: boolean
  state?: (state: HistoryState) => HistoryState
}

function buildHref(input: RouteLocationInput): string {
  return input.to.replace(/\$([A-Za-z][A-Za-z0-9]*)/g, (_match, key: string) => {
    const value = input.params?.[key]
    if (value === undefined) throw new Error(`missing route param: ${key}`)
    return encodeURIComponent(value)
  })
}
