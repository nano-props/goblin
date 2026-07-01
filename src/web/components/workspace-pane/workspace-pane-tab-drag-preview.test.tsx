// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { useWorkspacePaneTabDragPreview } from '#/web/components/workspace-pane/workspace-pane-tab-drag-preview.ts'

const REPO_ROOT = '/tmp/workspace-pane-tab-drag-preview-repo'
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/tmp/workspace-pane-tab-drag-preview-worktree'

let controls: WorkspacePaneTabDragPreviewControls | null = null

afterEach(() => {
  controls = null
})

describe('useWorkspacePaneTabDragPreview', () => {
  test('stages reordered tabs synchronously for drag layout only', () => {
    const sourceTabs = [terminalEntry('session-1'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('session-1')]
    renderPreviewHook({ canonicalTabs: sourceTabs })

    expect(currentControls().visualTabs).toEqual(sourceTabs)

    act(() => {
      expect(currentControls().stageDragPreview(reorderedTabs)).toBe(true)
    })

    expect(currentControls().visualTabs).toEqual(reorderedTabs)
  })

  test('clears the visual preview when canonical tabs catch up', () => {
    const sourceTabs = [terminalEntry('session-1'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('session-1')]
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

  test('does not stage a preview when the reorder is a no-op or has no branch target', () => {
    const sourceTabs = [terminalEntry('session-1'), staticEntry('status')]
    const renderResult = renderPreviewHook({ canonicalTabs: sourceTabs })

    act(() => {
      expect(currentControls().stageDragPreview([...sourceTabs])).toBe(false)
    })
    expect(currentControls().visualTabs).toEqual(sourceTabs)

    act(() => {
      renderResult.rerender(<HookHost input={previewInput({ branchName: null, canonicalTabs: sourceTabs })} />)
    })
    act(() => {
      expect(currentControls().stageDragPreview([staticEntry('status'), terminalEntry('session-1')])).toBe(false)
    })
    expect(currentControls().visualTabs).toEqual(sourceTabs)
  })

  test('clears a staged preview when the branch target changes', () => {
    const sourceTabs = [terminalEntry('session-1'), staticEntry('status')]
    const reorderedTabs = [staticEntry('status'), terminalEntry('session-1')]
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

    expect(currentControls().visualTabs).toEqual(sourceTabs)
  })
})

type WorkspacePaneTabDragPreviewControls = ReturnType<typeof useWorkspacePaneTabDragPreview>
type WorkspacePaneTabDragPreviewInput = Parameters<typeof useWorkspacePaneTabDragPreview>[0]

function renderPreviewHook(input: Partial<WorkspacePaneTabDragPreviewInput> = {}) {
  return renderInJsdom(<HookHost input={previewInput(input)} />)
}

function previewInput(input: Partial<WorkspacePaneTabDragPreviewInput> = {}): WorkspacePaneTabDragPreviewInput {
  return {
    repoRoot: REPO_ROOT,
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

function currentControls(): WorkspacePaneTabDragPreviewControls {
  if (!controls) throw new Error('missing workspace pane tab drag preview controls')
  return controls
}

function terminalEntry(sessionId: string): WorkspacePaneTabEntry {
  return workspacePaneTerminalTabEntry(sessionId)
}

function staticEntry(type: Parameters<typeof workspacePaneStaticTabEntry>[0]): WorkspacePaneTabEntry {
  return workspacePaneStaticTabEntry(type)
}
