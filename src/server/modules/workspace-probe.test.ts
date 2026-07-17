import { describe, expect, it, vi } from 'vitest'
import {
  probeLocalWorkspace,
  type LocalGitRootProbe,
  type LocalWorkspaceProbeDependencies,
} from '#/server/modules/workspace-probe.ts'

function gitProbe(result: LocalGitRootProbe): LocalWorkspaceProbeDependencies['gitRoot'] {
  return vi.fn(async () => result)
}

function dependencies(
  gitRoot: LocalWorkspaceProbeDependencies['gitRoot'],
  overrides: Partial<LocalWorkspaceProbeDependencies> = {},
): LocalWorkspaceProbeDependencies {
  return {
    stat: vi.fn(async () => ({ isDirectory: () => true })),
    access: vi.fn(async () => undefined),
    realpath: vi.fn(async (value) => value),
    gitRoot,
    ...overrides,
  }
}

describe('workspace probe', () => {
  it('opens a readable non-Git directory with files and terminal capabilities', async () => {
    const result = await probeLocalWorkspace('goblin+file:///workspace', 'posix', {
      dependencies: dependencies(gitProbe({ status: 'not-repository' })),
    })
    expect(result).toEqual({
      status: 'ready',
      name: 'workspace',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
  })

  it('ignores a Git repository found only in a parent directory', async () => {
    const result = await probeLocalWorkspace('goblin+file:///repo/child', 'posix', {
      dependencies: dependencies(gitProbe({ status: 'root', path: '/repo', pullRequests: 'none' })),
    })
    expect(result.status).toBe('ready')
    expect(result.status === 'ready' && result.capabilities.git).toEqual({ status: 'unavailable' })
  })

  it('enables Git only when canonical resolved roots match', async () => {
    const deps = dependencies(gitProbe({ status: 'root', path: '/link', pullRequests: 'github' }), {
      realpath: vi.fn(async () => '/canonical/repo'),
    })
    const result = await probeLocalWorkspace('goblin+file:///link', 'posix', { dependencies: deps })
    expect(result.status === 'ready' && result.capabilities.git).toEqual({
      status: 'available',
      worktrees: true,
      pullRequests: { provider: 'github' },
    })
  })

  it('keeps Git probe failures non-blocking and diagnostic', async () => {
    const result = await probeLocalWorkspace('goblin+file:///workspace', 'posix', {
      dependencies: dependencies(gitProbe({ status: 'inconclusive', diagnostic: 'git unavailable' })),
    })
    expect(result.status).toBe('ready')
    expect(result.status === 'ready' && result.capabilities.git).toEqual({ status: 'unavailable' })
    expect(result.status === 'ready' && result.diagnostics).toEqual([{ scope: 'git', message: 'git unavailable' }])
  })

  it.each([
    ['ENOENT', 'error.workspace-path-not-found'],
    ['ENOTDIR', 'error.workspace-path-not-directory'],
    ['EACCES', 'error.workspace-permission-denied'],
  ] as const)('maps directory failure %s at the availability boundary', async (code, reason) => {
    const result = await probeLocalWorkspace('goblin+file:///workspace', 'posix', {
      dependencies: dependencies(vi.fn(), {
        stat: vi.fn(async () => {
          throw Object.assign(new Error(code), { code })
        }),
      }),
    })
    expect(result).toEqual({ status: 'unavailable', reason })
  })

  it('rejects raw paths before touching the filesystem', async () => {
    const deps = dependencies(vi.fn())
    expect(await probeLocalWorkspace('/workspace', 'posix', { dependencies: deps })).toEqual({
      status: 'unavailable',
      reason: 'error.workspace-locator-malformed',
    })
    expect(deps.stat).not.toHaveBeenCalled()
  })
})
