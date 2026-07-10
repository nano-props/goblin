import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginWorkspacePaneTabControllerTransition,
  commitWorkspacePaneControllerCloseBackTarget,
  commitWorkspacePaneControllerRoute,
  observeWorkspacePaneTabControllerRoute,
  resetWorkspacePaneTabControllerForTest,
  showWorkspacePaneControllerRoute,
  workspacePaneTabControllerReconciliationDeferred,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { workspacePaneStaticTabId, type WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { RepoWorkspaceStaticTab, RepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'

describe('workspace pane tab controller', () => {
  beforeEach(() => {
    resetWorkspacePaneTabControllerForTest()
  })

  test('defers stale-route reconciliation while an internal tab transition is pending', () => {
    beginWorkspacePaneTabControllerTransition({
      repoId: '/tmp/repo',
      branchName: 'feature/a',
      fromRoute: { kind: 'static', tab: 'files' },
      toRoute: { kind: 'static', tab: 'status' },
    })

    expect(
      workspacePaneTabControllerReconciliationDeferred({
        repoId: '/tmp/repo',
        branchName: 'feature/a',
        route: { kind: 'static', tab: 'files' },
        reconciliation: { kind: 'replace-empty-pane' },
      }),
    ).toBe(true)
  })

  test('clears a pending transition once the observed route leaves the source route', () => {
    beginWorkspacePaneTabControllerTransition({
      repoId: '/tmp/repo',
      branchName: 'feature/a',
      fromRoute: { kind: 'static', tab: 'files' },
      toRoute: { kind: 'static', tab: 'status' },
    })

    observeWorkspacePaneTabControllerRoute({
      repoId: '/tmp/repo',
      branchName: 'feature/a',
      route: { kind: 'static', tab: 'status' },
    })

    expect(
      workspacePaneTabControllerReconciliationDeferred({
        repoId: '/tmp/repo',
        branchName: 'feature/a',
        route: { kind: 'static', tab: 'files' },
        reconciliation: { kind: 'replace-empty-pane' },
      }),
    ).toBe(false)
  })

  test('routes tab selections through one controller dispatch surface', () => {
    const navigation = {
      showRepoBranchEmptyWorkspacePane: vi.fn(() => true),
      showRepoBranchWorkspacePaneTab: vi.fn(() => true),
      showRepoBranchTerminalSession: vi.fn(() => true),
    }

    expect(showWorkspacePaneControllerRoute('/tmp/repo', 'feature/a', { kind: 'static', tab: 'files' }, navigation)).toBe(
      true,
    )
    expect(showWorkspacePaneControllerRoute('/tmp/repo', 'feature/a', null, navigation)).toBe(true)
    expect(
      showWorkspacePaneControllerRoute(
        '/tmp/repo',
        'feature/a',
        { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
        navigation,
      ),
    ).toBe(true)

    expect(navigation.showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith('/tmp/repo', 'feature/a', 'files')
    expect(navigation.showRepoBranchEmptyWorkspacePane).toHaveBeenCalledWith('/tmp/repo', 'feature/a')
    expect(navigation.showRepoBranchTerminalSession).toHaveBeenCalledWith(
      '/tmp/repo',
      'feature/a',
      'term-111111111111111111111',
    )
  })

  test('commits close-back targets through the operation-owned route path', () => {
    const navigation = {
      showRepoBranchWorkspacePaneTab: vi.fn(() => false),
      commitRepoBranchWorkspacePaneRoute: vi.fn(() => true),
    }

    expect(
      commitWorkspacePaneControllerCloseBackTarget(workspacePaneTarget(), staticTab('status'), navigation),
    ).toBe(true)

    expect(navigation.commitRepoBranchWorkspacePaneRoute).toHaveBeenCalledWith(
      '/tmp/repo',
      'feature/a',
      { kind: 'static', tab: 'status' },
      undefined,
    )
    expect(navigation.showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('does not fall back from operation-owned commits to blockable show navigation', () => {
    const navigation = {
      showRepoBranchWorkspacePaneTab: vi.fn(() => true),
    }

    expect(
      commitWorkspacePaneControllerRoute('/tmp/repo', 'feature/a', { kind: 'static', tab: 'status' }, navigation),
    ).toBe(false)

    expect(navigation.showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
  })
})

function workspacePaneTarget(): RepoWorkspaceTabModel {
  return {
    repoId: '/tmp/repo',
    repoRuntimeId: 'repo-runtime-1',
    branchName: 'feature/a',
    worktreePath: '/tmp/worktree-a',
  } as RepoWorkspaceTabModel
}

function staticTab(type: WorkspacePaneStaticTabType): RepoWorkspaceStaticTab {
  return {
    identity: workspacePaneStaticTabId(type),
    type,
    kind: 'static',
    view: null,
  }
}
