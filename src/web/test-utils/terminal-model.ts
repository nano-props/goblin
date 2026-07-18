import { terminalGitWorktreePresentation, type TerminalSessionBase } from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator, formatWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { terminalDescriptor } from '#/web/components/terminal/terminal-descriptor.ts'
import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'

export function terminalSessionBaseForTest(input: {
  repoRoot: string
  repoRuntimeId: string
  branch: string | null
  worktreePath: string
}): TerminalSessionBase {
  const workspaceId = requiredWorkspaceLocator(input.repoRoot)
  if (input.branch === null) {
    return {
      target: { kind: 'workspace-root', workspaceId, workspaceRuntimeId: input.repoRuntimeId },
      presentation: { kind: 'workspace-root' },
    }
  }
  return {
    target: {
      kind: 'git-worktree',
      workspaceId,
      workspaceRuntimeId: input.repoRuntimeId,
      root: requiredWorkspaceLocator(input.worktreePath),
    },
    presentation: terminalGitWorktreePresentation(input.branch),
  }
}

export function terminalDescriptorForTest(input: {
  terminalSessionId: string
  index: number
  repoRoot: string
  repoRuntimeId: string
  branch: string | null
  worktreePath: string
}): TerminalDescriptor {
  return terminalDescriptor(terminalSessionBaseForTest(input), input.terminalSessionId, input.index)
}

function requiredWorkspaceLocator(input: string) {
  const locator =
    canonicalWorkspaceLocator(input) ??
    formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: input }, 'posix')
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}
