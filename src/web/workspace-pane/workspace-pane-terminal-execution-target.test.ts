import { describe, expect, test } from 'vitest'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { resolveWorkspacePaneTerminalExecutionTarget } from '#/web/workspace-pane/workspace-pane-terminal-execution-target.ts'

const WORKSPACE_ID = canonicalWorkspaceLocator('goblin+file:///workspace/project')!
const WORKTREE_ID = canonicalWorkspaceLocator('goblin+file:///workspace/project-worktree')!
const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'

describe('workspace pane terminal execution target resolver', () => {
  test('rejects branch-only and mismatched presentation targets', () => {
    expect(
      resolveWorkspacePaneTerminalExecutionTarget(
        { kind: 'git-branch', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID, branch: 'main' },
        { kind: 'git-worktree', head: { kind: 'branch', branchName: 'main' } },
      ),
    ).toBeNull()
    expect(
      resolveWorkspacePaneTerminalExecutionTarget(
        { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        { kind: 'git-worktree', head: { kind: 'detached' } },
      ),
    ).toBeNull()
  })

  test('accepts canonical worktree execution independently of branch presentation', () => {
    const target = {
      kind: 'git-worktree' as const,
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      root: WORKTREE_ID,
    }
    expect(resolveWorkspacePaneTerminalExecutionTarget(target, { kind: 'git-worktree', head: { kind: 'detached' } }))
      .toEqual({ target, presentation: { kind: 'git-worktree', head: { kind: 'detached' } } })
    expect(
      resolveWorkspacePaneTerminalExecutionTarget(target, {
        kind: 'git-worktree',
        head: { kind: 'branch', branchName: 'renamed' },
      }),
    ).toEqual({ target, presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'renamed' } } })
  })
})
