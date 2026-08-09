// @vitest-environment jsdom

import { QueryClient } from '@tanstack/vue-query'
import { defineComponent } from 'vue'
import { afterEach, describe, expect, test } from 'vitest'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  useWorkspacePaneTabDragPreview,
  type WorkspacePaneTabDragPreviewState,
} from '#/web/components/workspace-pane/workspace-pane-tab-drag-preview.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/workspace-pane-tab-drag-preview')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-drag-preview'
const WORKTREE_PATH = '/tmp/workspace-pane-tab-drag-preview-worktree'
let controls: WorkspacePaneTabDragPreviewState | null = null

afterEach(() => {
  controls = null
})

describe('useWorkspacePaneTabDragPreview', () => {
  test('owns one visual preview until its reorder transaction settles', async () => {
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [...sourceTabs].reverse()
    renderPreviewHook(sourceTabs)

    const release = currentControls().stageDragPreview(reorderedTabs)

    expect(release).toEqual(expect.any(Function))
    expect(currentControls().visualTabs.value).toEqual(reorderedTabs)

    await flushTestUpdates(() => release?.())

    expect(currentControls().visualTabs.value).toEqual(sourceTabs)
  })

  test('does not mutate the authoritative workspace-pane query cache', () => {
    const queryClient = new QueryClient()
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [...sourceTabs].reverse()
    setWorkspacePaneTabsForTargetQueryData(
      {
        kind: 'git-worktree',
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        worktreePath: WORKTREE_PATH,
        tabs: sourceTabs,
      },
      queryClient,
    )
    renderPreviewHook(sourceTabs)

    currentControls().stageDragPreview(reorderedTabs)

    expect(currentControls().visualTabs.value).toEqual(reorderedTabs)
    expect(
      readWorkspacePaneTabsForTarget(
        {
          kind: 'git-worktree',
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
          worktreePath: WORKTREE_PATH,
        },
        queryClient,
      ),
    ).toEqual(sourceTabs)
    queryClient.clear()
  })

  test('cannot resurrect a settled preview after canonical tabs change again', async () => {
    const sourceTabs = [terminalEntry('term-111111111111111111111'), staticEntry('status')]
    const reorderedTabs = [...sourceTabs].reverse()
    const rendered = renderPreviewHook(sourceTabs)
    const release = currentControls().stageDragPreview(reorderedTabs)

    await rendered.rerender(<HookHost canonicalTabs={reorderedTabs} />)
    release?.()
    await rendered.rerender(<HookHost canonicalTabs={sourceTabs} />)

    expect(currentControls().visualTabs.value).toEqual(sourceTabs)
  })

  test('an older reorder settlement cannot clear a newer preview lease', async () => {
    const sourceTabs = [staticEntry('status'), staticEntry('files'), staticEntry('history')]
    const firstTabs = [staticEntry('files'), staticEntry('status'), staticEntry('history')]
    const secondTabs = [staticEntry('history'), staticEntry('files'), staticEntry('status')]
    renderPreviewHook(sourceTabs)

    const releaseFirst = currentControls().stageDragPreview(firstTabs)
    const releaseSecond = currentControls().stageDragPreview(secondTabs)
    await flushTestUpdates(() => releaseFirst?.())

    expect(currentControls().visualTabs.value).toEqual(secondTabs)

    await flushTestUpdates(() => releaseSecond?.())

    expect(currentControls().visualTabs.value).toEqual(sourceTabs)
  })

  test('does not create a lease for a no-op reorder', () => {
    const sourceTabs = [staticEntry('status'), staticEntry('files')]
    renderPreviewHook(sourceTabs)

    expect(currentControls().stageDragPreview([...sourceTabs])).toBeNull()
    expect(currentControls().visualTabs.value).toEqual(sourceTabs)
  })

  test('a keyed target owner discards its preview when navigation leaves and returns', async () => {
    const sourceTabs = [staticEntry('status'), staticEntry('files')]
    const reorderedTabs = [...sourceTabs].reverse()
    const rendered = renderInJsdom(<KeyedHookHost targetKey="target-a" canonicalTabs={sourceTabs} />)
    currentControls().stageDragPreview(reorderedTabs)
    expect(currentControls().visualTabs.value).toEqual(reorderedTabs)

    await rendered.rerender(<KeyedHookHost targetKey="target-b" canonicalTabs={sourceTabs} />)
    expect(currentControls().visualTabs.value).toEqual(sourceTabs)

    await rendered.rerender(<KeyedHookHost targetKey="target-a" canonicalTabs={sourceTabs} />)
    expect(currentControls().visualTabs.value).toEqual(sourceTabs)
  })
})

const HookHost = defineComponent<{ canonicalTabs: readonly WorkspacePaneTabEntry[] }>({
  name: 'WorkspacePaneTabDragPreviewHarness',
  props: ['canonicalTabs'],
  setup(props) {
    controls = useWorkspacePaneTabDragPreview(() => props.canonicalTabs)
    return () => null
  },
})

const KeyedHookHost = defineComponent<{ targetKey: string; canonicalTabs: readonly WorkspacePaneTabEntry[] }>({
  name: 'KeyedWorkspacePaneTabDragPreviewHarness',
  props: ['targetKey', 'canonicalTabs'],
  setup(props) {
    return () => <HookHost key={props.targetKey} canonicalTabs={props.canonicalTabs} />
  },
})

function renderPreviewHook(canonicalTabs: readonly WorkspacePaneTabEntry[]) {
  return renderInJsdom(<HookHost canonicalTabs={canonicalTabs} />)
}

function currentControls(): WorkspacePaneTabDragPreviewState {
  if (!controls) throw new Error('missing workspace pane tab drag preview controls')
  return controls
}

function staticEntry(type: 'status' | 'files' | 'history'): WorkspacePaneTabEntry {
  return workspacePaneStaticTabEntry(type)
}

function terminalEntry(id: string): WorkspacePaneTabEntry {
  return workspacePaneRuntimeTabEntry('terminal', id)
}
