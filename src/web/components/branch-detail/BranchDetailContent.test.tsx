// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { BranchDetailContent } from '#/web/components/branch-detail/BranchDetailContent.tsx'
import { getSelectedBranchDetailPresentation } from '#/web/components/branch-detail/model.ts'
import { TerminalSessionReadContext } from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalSessionReadContextValue, WorktreeTerminalSnapshot } from '#/web/components/terminal/types.ts'
import { DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'

const REPO_ID = '/tmp/gbl-branch-detail-content-repo'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('BranchDetailContent', () => {
  test('renders branch status for a selected branch without a worktree', () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [
        createRepoBranch('feature/no-worktree', {
          tracking: 'origin/feature/no-worktree',
          lastCommitHash: 'abc1234',
          lastCommitMessage: 'Update placeholder branch',
          lastCommitAuthor: 'Example Author',
          lastCommitDate: '2026-01-01T00:00:00.000Z',
        }),
      ],
      selectedBranch: 'feature/no-worktree',
      workspacePaneView: 'status',
    })
    const detail = getSelectedBranchDetailPresentation(repo)

    act(() => {
      root!.render(
        <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
          <BranchDetailContent
            repo={repo}
            detail={detail}
            detailId="detail"
            contentId="content"
            layout={DEFAULT_WORKSPACE_LAYOUT}
          />
        </TerminalSessionReadContext.Provider>,
      )
    })

    expect(container?.querySelector('#detail-status-panel')).not.toBeNull()
    expect(container?.textContent).toContain('feature/no-worktree')
    expect(container?.textContent).toContain('branch-status.worktree.none')
    expect(container?.textContent).not.toContain('workspace-pane-views.empty')
  })
})

const emptyWorktreeSnapshot: WorktreeTerminalSnapshot = {
  worktreeTerminalKey: '',
  selectedDescriptor: null,
  sessions: [],
  staticWorkspacePaneViews: [],
  workspacePaneViews: [],
  count: 0,
  pendingCreate: false,
}

const emptyTerminalReadContext: TerminalSessionReadContextValue = {
  worktreeSnapshot: () => emptyWorktreeSnapshot,
  subscribeWorktree: () => () => {},
  snapshot: () => ({ phase: 'opening', message: null, processName: 'terminal' }),
  subscribeSnapshot: () => () => {},
}
