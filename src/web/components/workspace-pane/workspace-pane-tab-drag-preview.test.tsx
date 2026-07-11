// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import {
  type WorkspacePaneTabDragPreviewInput,
  type WorkspacePaneTabDragPreviewState,
  useWorkspacePaneTabDragPreview,
} from '#/web/components/workspace-pane/workspace-pane-tab-drag-preview.ts'

const REPO_ROOT = '/tmp/workspace-pane-tab-drag-preview-repo'
const REPO_RUNTIME_ID = 'repo-runtime-test'
const NEXT_REPO_RUNTIME_ID = 'repo-runtime-next'
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/tmp/workspace-pane-tab-drag-preview-worktree'

let controls: WorkspacePaneTabDragPreviewState | null = null

afterEach(() => {
  controls = null
})

describe('useWorkspacePaneTabDragPreview', () => {
  test('stages reordered tabs synchronously for drag layout only', () => {
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    renderPreviewHook({ canonicalTabs: sourceTabs })

    expect(currentControls().visualTabs).toEqual(sourceTabs)

    act(() => {
      expect(currentControls().stageDragPreview(reorderedTabs)).toBe(true)
    })

    expect(currentControls().visualTabs).toEqual(reorderedTabs)
  })

  test('does not mutate workspace pane tabs query cache', () => {
    const queryClient = new QueryClient()
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    setWorkspacePaneTabsForTargetQueryData(
      {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: sourceTabs,
      },
      queryClient,
    )
    renderPreviewHook({ canonicalTabs: sourceTabs })

    act(() => {
      expect(currentControls().stageDragPreview(reorderedTabs)).toBe(true)
    })

    expect(currentControls().visualTabs).toEqual(reorderedTabs)
    expect(readWorkspacePaneTabsFromQueryCache(queryClient)).toEqual(sourceTabs)
    queryClient.clear()
  })

  test('clears the visual preview when canonical tabs catch up', () => {
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    const renderResult = renderPreviewHook({ canonicalTabs: sourceTabs })

    act(() => {
      expect(currentControls().stageDragPreview(reorderedTabs)).toBe(true)
    })
    expect(currentControls().visualTabs).toEqual(reorderedTabs)

    act(() => {
      renderResult.rerender(<HookHost input={previewInput({ canonicalTabs: reorderedTabs })} />)
    })

    expect(currentControls().visualTabs).toEqual(reorderedTabs)
  })

  test('does not stage a preview when the reorder is a no-op or has no tab target', () => {
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const renderResult = renderPreviewHook({ canonicalTabs: sourceTabs })

    act(() => {
      expect(currentControls().stageDragPreview([...sourceTabs])).toBe(false)
    })
    expect(currentControls().visualTabs).toEqual(sourceTabs)

    act(() => {
      renderResult.rerender(<HookHost input={previewInput({ branchName: null, canonicalTabs: sourceTabs })} />)
    })
    act(() => {
      expect(currentControls().stageDragPreview([staticEntry('status'), terminalEntry('term-111111111111111111111')])).toBe(false)
    })
    expect(currentControls().visualTabs).toEqual(sourceTabs)
  })

  test('keeps a staged preview when only a worktree target branch changes', () => {
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    const renderResult = renderPreviewHook({ canonicalTabs: sourceTabs })

    act(() => {
      expect(currentControls().stageDragPreview(reorderedTabs)).toBe(true)
    })
    expect(currentControls().visualTabs).toEqual(reorderedTabs)

    act(() => {
      renderResult.rerender(
        <HookHost input={previewInput({ branchName: 'feature/other', canonicalTabs: sourceTabs })} />,
      )
    })

    expect(currentControls().visualTabs).toEqual(reorderedTabs)
  })

  test('clears a staged preview when the tab target identity changes', () => {
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    const renderResult = renderPreviewHook({ canonicalTabs: sourceTabs })

    act(() => {
      expect(currentControls().stageDragPreview(reorderedTabs)).toBe(true)
    })
    expect(currentControls().visualTabs).toEqual(reorderedTabs)

    act(() => {
      renderResult.rerender(
        <HookHost
          input={previewInput({
            worktreePath: '/tmp/workspace-pane-tab-drag-preview-other',
            canonicalTabs: sourceTabs,
          })}
        />,
      )
    })

    expect(currentControls().visualTabs).toEqual(sourceTabs)
  })

  test('clears a staged preview when the repo runtime changes', () => {
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('term-111111111111111111111')]
    const renderResult = renderPreviewHook({ canonicalTabs: sourceTabs })

    act(() => {
      expect(currentControls().stageDragPreview(reorderedTabs)).toBe(true)
    })
    expect(currentControls().visualTabs).toEqual(reorderedTabs)

    act(() => {
      renderResult.rerender(
        <HookHost
          input={previewInput({
            repoRuntimeId: NEXT_REPO_RUNTIME_ID,
            canonicalTabs: sourceTabs,
          })}
        />,
      )
    })

    expect(currentControls().visualTabs).toEqual(sourceTabs)
  })
})

function renderPreviewHook(input: Partial<WorkspacePaneTabDragPreviewInput> = {}) {
  return renderInJsdom(<HookHost input={previewInput(input)} />)
}

function previewInput(input: Partial<WorkspacePaneTabDragPreviewInput> = {}): WorkspacePaneTabDragPreviewInput {
  return {
    repoRoot: REPO_ROOT,
    repoRuntimeId: REPO_RUNTIME_ID,
    branchName: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
    canonicalTabs: [],
    ...input,
  }
}

function HookHost({ input }: { input: WorkspacePaneTabDragPreviewInput }) {
  controls = useWorkspacePaneTabDragPreview(input)
  return null
}

function currentControls(): WorkspacePaneTabDragPreviewState {
  if (!controls) throw new Error('missing workspace pane tab drag preview controls')
  return controls
}

function readWorkspacePaneTabsFromQueryCache(queryClient: QueryClient): WorkspacePaneTabEntry[] {
  return readWorkspacePaneTabsForTarget(
    {
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
    },
    queryClient,
  )
}

function terminalEntry(sessionId: string): WorkspacePaneTabEntry {
  return workspacePaneRuntimeTabEntry('terminal', sessionId)
}

function staticEntry(type: Parameters<typeof workspacePaneStaticTabEntry>[0]): WorkspacePaneTabEntry {
  return workspacePaneStaticTabEntry(type)
}
