import { describe, expect, test, vi } from 'vitest'
import { createRepoMutationApplication } from '#/server/repo-mutation/repo-mutation-application.ts'

describe('repo mutation application', () => {
  test('retires a branch target only after branch deletion succeeds', async () => {
    const retireTarget = vi.fn(async () => {})
    const application = createRepoMutationApplication({ workspacePaneTabs: { retireTarget } })

    await expect(
      application.deleteBranch('user-a', {
        repoRoot: '/repo',
        repoRuntimeId: 'runtime-a',
        branchName: 'feature/retired',
        deleteBranch: async () => ({ ok: true, message: 'deleted' }),
      }),
    ).resolves.toEqual({ ok: true, message: 'deleted' })
    expect(retireTarget).toHaveBeenCalledWith('user-a', {
      repoRuntimeId: 'runtime-a',
      target: { kind: 'branch', repoRoot: '/repo', branchName: 'feature/retired' },
    })

    await expect(
      application.deleteBranch('user-a', {
        repoRoot: '/repo',
        repoRuntimeId: 'runtime-a',
        branchName: 'feature/kept',
        deleteBranch: async () => ({ ok: false, message: 'failed' }),
      }),
    ).resolves.toEqual({ ok: false, message: 'failed' })
    expect(retireTarget).toHaveBeenCalledTimes(1)
  })

  test('reports the committed repository change when branch retirement fails', async () => {
    const retireTarget = vi.fn(async () => {
      throw new Error('pane persistence failed')
    })
    const application = createRepoMutationApplication({ workspacePaneTabs: { retireTarget } })

    await expect(
      application.deleteBranch('user-a', {
        repoRoot: '/repo',
        repoRuntimeId: 'runtime-a',
        branchName: 'feature/deleted',
        deleteBranch: async () => ({ ok: true, message: 'deleted' }),
      }),
    ).resolves.toEqual({
      ok: false,
      message: 'pane persistence failed',
      repositoryStateChanged: true,
    })
  })
})
