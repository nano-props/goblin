import { describe, expect, test, vi } from 'vitest'
import { getWorktreePatch } from '#/system/git/patch.ts'

const gitMock = vi.hoisted(() => vi.fn())
const execaMock = vi.hoisted(() => vi.fn())

vi.mock('#/system/git/git-exec.ts', async () => {
  const actual = await vi.importActual<typeof import('#/system/git/git-exec.ts')>('#/system/git/git-exec.ts')
  return {
    ...actual,
    git: vi.fn((cwd: string, args: string[], options?: unknown) => gitMock(cwd, args, options)),
  }
})

vi.mock('execa', async () => {
  const actual = await vi.importActual<typeof import('execa')>('execa')
  return {
    ...actual,
    execa: vi.fn((file: string, args: string[], options?: unknown) => execaMock(file, args, options)),
  }
})

describe('getWorktreePatch', () => {
  test('includes untracked files in the generated patch', async () => {
    gitMock.mockReset()
    execaMock.mockReset()
    gitMock
      .mockResolvedValueOnce('diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n')
      .mockResolvedValueOnce('?? new file.txt\0')
    execaMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout:
        'diff --git a/new file.txt b/new file.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new file.txt\n+untracked\n',
      isCanceled: false,
    } as any)

    const patch = await getWorktreePatch('/tmp/repo')

    expect(gitMock).toHaveBeenNthCalledWith(1, '/tmp/repo', ['diff', 'HEAD', '--binary'], { signal: undefined })
    expect(gitMock).toHaveBeenNthCalledWith(2, '/tmp/repo', ['status', '--porcelain', '-z', '-uall'], {
      signal: undefined,
    })
    expect(execaMock).toHaveBeenCalledWith(
      'git',
      ['diff', '--binary', '--no-index', '--', '/dev/null', 'new file.txt'],
      expect.objectContaining({ cwd: '/tmp/repo', reject: false }),
    )
    expect(patch).toContain('new file mode')
    expect(patch).toContain('new file.txt')
    expect(patch).toContain('+untracked')
    expect(patch.endsWith('\n')).toBe(true)
  })
})
