// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { useWorkspacePaneVisibleStatusRefresh } from '#/web/components/repo-workspace/use-workspace-pane-visible-status-refresh.ts'
import { requestVisibleWorkspaceStatusRefresh } from '#/web/stores/repos/repo-refresh-actions.ts'

vi.mock('#/web/stores/repos/repo-refresh-actions.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/web/stores/repos/repo-refresh-actions.ts')>()
  return { ...actual, requestVisibleWorkspaceStatusRefresh: vi.fn(() => true) }
})

const REPO_ID = 'goblin+file:///tmp/visible-status-refresh-repo'
const WORKSPACE_RUNTIME_ID = 'repo-runtime-visible-status-refresh'

function Harness({
  branchName = 'main',
  renderedTab = 'status',
  unavailable = false,
}: {
  branchName?: string | null
  renderedTab?: WorkspacePaneTabType | null
  unavailable?: boolean
}) {
  useWorkspacePaneVisibleStatusRefresh({
    repoId: REPO_ID,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    branchName,
    renderedTab,
    unavailable,
  })
  return null
}

describe('useWorkspacePaneVisibleStatusRefresh', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.mocked(requestVisibleWorkspaceStatusRefresh).mockReset()
    vi.mocked(requestVisibleWorkspaceStatusRefresh).mockReturnValue(true)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  test.each(['status', 'changes'] satisfies WorkspacePaneTabType[])(
    'refreshes visible status for rendered %s',
    async (renderedTab) => {
      await act(async () => {
        root.render(<Harness renderedTab={renderedTab} />)
      })

      expect(requestVisibleWorkspaceStatusRefresh).toHaveBeenCalledOnce()
      expect(requestVisibleWorkspaceStatusRefresh).toHaveBeenCalledWith(
        expect.any(Object),
        REPO_ID,
        WORKSPACE_RUNTIME_ID,
        'main',
      )
    },
  )

  test.each(['files', 'history', 'terminal'] satisfies WorkspacePaneTabType[])(
    'does not refresh for rendered %s',
    async (renderedTab) => {
      await act(async () => {
        root.render(<Harness renderedTab={renderedTab} />)
      })

      expect(requestVisibleWorkspaceStatusRefresh).not.toHaveBeenCalled()
    },
  )

  test('refreshes again when the visible branch changes', async () => {
    await act(async () => {
      root.render(<Harness branchName="main" renderedTab="status" />)
    })
    vi.mocked(requestVisibleWorkspaceStatusRefresh).mockClear()

    await act(async () => {
      root.render(<Harness branchName="feature/a" renderedTab="status" />)
    })

    expect(requestVisibleWorkspaceStatusRefresh).toHaveBeenCalledWith(
      expect.any(Object),
      REPO_ID,
      WORKSPACE_RUNTIME_ID,
      'feature/a',
    )
  })

  test('waits until the repo is available before recording the visible target', async () => {
    await act(async () => {
      root.render(<Harness branchName="feature/a" renderedTab="status" unavailable />)
    })
    expect(requestVisibleWorkspaceStatusRefresh).not.toHaveBeenCalled()

    await act(async () => {
      root.render(<Harness branchName="feature/a" renderedTab="status" unavailable={false} />)
    })

    expect(requestVisibleWorkspaceStatusRefresh).toHaveBeenCalledOnce()
    expect(requestVisibleWorkspaceStatusRefresh).toHaveBeenCalledWith(
      expect.any(Object),
      REPO_ID,
      WORKSPACE_RUNTIME_ID,
      'feature/a',
    )
  })

  test('does not refresh without a branch', async () => {
    await act(async () => {
      root.render(<Harness branchName={null} renderedTab="status" />)
    })

    expect(requestVisibleWorkspaceStatusRefresh).not.toHaveBeenCalled()
  })
})
