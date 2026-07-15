import { describe, expect, test, vi } from 'vitest'
import { createRepoMutationApplication } from '#/server/repo-mutation/repo-mutation-application.ts'

describe('repo mutation application', () => {
  test('does not retire pane layout after branch deletion', async () => {
    const retireTarget = vi.fn(async () => {})
    const application = createRepoMutationApplication()

    await expect(
      application.deleteBranch('user-a', {
        repoRoot: '/repo',
        repoRuntimeId: 'runtime-a',
        branchName: 'feature/retired',
        deleteBranch: async () => ({ ok: true, message: 'deleted' }),
      }),
    ).resolves.toEqual({ ok: true, message: 'deleted' })
    expect(retireTarget).not.toHaveBeenCalled()

    await expect(
      application.deleteBranch('user-a', {
        repoRoot: '/repo',
        repoRuntimeId: 'runtime-a',
        branchName: 'feature/kept',
        deleteBranch: async () => ({ ok: false, message: 'failed' }),
      }),
    ).resolves.toEqual({ ok: false, message: 'failed' })
    expect(retireTarget).not.toHaveBeenCalled()
  })

  test('does not expose a second persistence failure after branch deletion', async () => {
    const retireTarget = vi.fn(async () => {
      throw new Error('pane persistence failed')
    })
    const application = createRepoMutationApplication()

    await expect(
      application.deleteBranch('user-a', {
        repoRoot: '/repo',
        repoRuntimeId: 'runtime-a',
        branchName: 'feature/deleted',
        deleteBranch: async () => ({ ok: true, message: 'deleted' }),
      }),
    ).resolves.toEqual({ ok: true, message: 'deleted' })
  })
})
