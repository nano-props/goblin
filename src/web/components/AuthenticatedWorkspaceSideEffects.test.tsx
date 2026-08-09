// @vitest-environment jsdom

import { defineComponent, ref } from 'vue'
import { describe, expect, test, vi } from 'vitest'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import { AuthenticatedWorkspaceSideEffects } from '#/web/components/AuthenticatedWorkspaceSideEffects.tsx'
import type { WorkspaceNavigationRouteContext } from '#/web/workspace-navigation-history.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'

const sideEffectMocks = vi.hoisted(() => ({
  useBackgroundFetch: vi.fn(),
  useClientEffectIntentRouter: vi.fn(),
  useClientWorkspacePersistence: vi.fn(),
  useKeyboard: vi.fn(),
  useRepoStoreInvalidationRefresh: vi.fn(),
  useWorkspaceRuntimeInvalidationRefresh: vi.fn(),
  useSettingsQueryInvalidationSync: vi.fn(),
  useWorkspaceNavigationHistory: vi.fn(),
  useTerminalRetirementWorkspacePanePresentation: vi.fn(),
}))

vi.mock('#/web/hooks/useBackgroundFetch.ts', () => ({
  useBackgroundFetch: sideEffectMocks.useBackgroundFetch,
}))
vi.mock('#/web/hooks/useClientEffectIntentRouter.ts', () => ({
  useClientEffectIntentRouter: sideEffectMocks.useClientEffectIntentRouter,
}))
vi.mock('#/web/hooks/useClientWorkspacePersistence.ts', () => ({
  useClientWorkspacePersistence: sideEffectMocks.useClientWorkspacePersistence,
}))
vi.mock('#/web/hooks/useKeyboard.ts', () => ({ useKeyboard: sideEffectMocks.useKeyboard }))
vi.mock('#/web/hooks/useRepoStoreInvalidationRefresh.ts', () => ({
  useRepoStoreInvalidationRefresh: sideEffectMocks.useRepoStoreInvalidationRefresh,
}))
vi.mock('#/web/hooks/useWorkspaceRuntimeInvalidationRefresh.ts', () => ({
  useWorkspaceRuntimeInvalidationRefresh: sideEffectMocks.useWorkspaceRuntimeInvalidationRefresh,
}))
vi.mock('#/web/settings-queries.ts', () => ({
  useSettingsQueryInvalidationSync: sideEffectMocks.useSettingsQueryInvalidationSync,
}))
vi.mock('#/web/workspace-navigation-history.ts', () => ({
  useWorkspaceNavigationHistory: sideEffectMocks.useWorkspaceNavigationHistory,
}))
vi.mock('#/web/workspace-pane/use-terminal-retirement-workspace-pane-presentation.ts', () => ({
  useTerminalRetirementWorkspacePanePresentation: sideEffectMocks.useTerminalRetirementWorkspacePanePresentation,
}))

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/stable-side-effects-workspace')

describe('AuthenticatedWorkspaceSideEffects', () => {
  test('keeps one owner while route inputs change and resolves the command target at event time', async () => {
    const firstTarget: WorkspacePaneCommandTarget = {
      routeTarget: { kind: 'git-branch', workspaceId: WORKSPACE_ID, branchName: 'feature/first' },
      workspacePaneRoute: null,
      filesystemTarget: null,
    }
    const secondTarget: WorkspacePaneCommandTarget = {
      routeTarget: { kind: 'git-branch', workspaceId: WORKSPACE_ID, branchName: 'feature/second' },
      workspacePaneRoute: { kind: 'static', tab: 'history' },
      filesystemTarget: null,
    }
    const currentBranchName = ref('feature/first')
    const currentTarget = ref<WorkspacePaneCommandTarget | null>(firstTarget)
    const routeContext = ref<WorkspaceNavigationRouteContext | null>({
      kind: 'branch',
      workspaceId: WORKSPACE_ID,
      branchName: 'feature/first',
      workspacePaneRoute: null,
    })
    const navigation = appNavigationActionsForTest({ openCreateWorktree: vi.fn() })
    const currentWorkspacePaneCommandTarget = () => currentTarget.value
    const SideEffectsHost = defineComponent({
      name: 'AuthenticatedWorkspaceSideEffectsHost',
      inheritAttrs: false,
      setup() {
        return () => (
          <AuthenticatedWorkspaceSideEffects
            routedWorkspaceId={WORKSPACE_ID}
            hydratedRouteWorkspaceId={WORKSPACE_ID}
            currentBranchName={currentBranchName.value}
            currentWorkspacePaneCommandTarget={currentWorkspacePaneCommandTarget}
            routeContext={routeContext.value}
            navigation={navigation}
            closeAllOverlays={() => {}}
            openWorkspacePathDialog={() => {}}
            openCloneRepo={() => {}}
            openRemoteWorkspace={() => {}}
            modalOpen={false}
            navigateToSettingsShortcuts={() => {}}
            navigateToIndex={() => {}}
          />
        )
      },
    })

    renderInJsdom(<SideEffectsHost />)

    const intentOptions = sideEffectMocks.useClientEffectIntentRouter.mock.calls[0]?.[0]
    const keyboardOptions = sideEffectMocks.useKeyboard.mock.calls[0]?.[0]
    const retirementOptions = sideEffectMocks.useTerminalRetirementWorkspacePanePresentation.mock.calls[0]?.[0]
    const historyOptions = sideEffectMocks.useWorkspaceNavigationHistory.mock.calls[0]?.[0]
    if (!intentOptions || !keyboardOptions || !retirementOptions || !historyOptions) {
      throw new Error('Missing side-effect owner inputs')
    }
    expect(intentOptions.currentWorkspacePaneCommandTarget()).toEqual(firstTarget)

    await flushTestUpdates(() => {
      currentBranchName.value = 'feature/second'
      currentTarget.value = secondTarget
      routeContext.value = {
        kind: 'branch',
        workspaceId: WORKSPACE_ID,
        branchName: 'feature/second',
        workspacePaneRoute: { kind: 'static', tab: 'history' },
      }
    })

    for (const [name, owner] of Object.entries(sideEffectMocks)) {
      if (name !== 'useBackgroundFetch') expect(owner).toHaveBeenCalledOnce()
    }
    // Query-backed background fetch is a nested conditional resource owner;
    // the stable ingress owner does not fabricate a target for an absent repo.
    expect(sideEffectMocks.useBackgroundFetch).not.toHaveBeenCalled()
    expect(intentOptions.currentWorkspacePaneCommandTarget()).toEqual(secondTarget)
    expect(keyboardOptions.currentWorkspacePaneCommandTarget()).toEqual(secondTarget)
    expect(keyboardOptions.currentBranchName()).toBe('feature/second')
    expect(retirementOptions.currentTarget()).toEqual(secondTarget)
    expect(historyOptions.routeContext()).toEqual(routeContext.value)
  })
})
