import { describe, expect, test, vi } from 'vitest'
import type * as RepoWritePaths from '#/server/modules/repo-write-paths.ts'
import type { CommandOutcome } from '#/system/command-execution.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'
import { commandOutcomeForTest } from '#/test-utils/command-outcome.ts'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import { useFakeTimers } from '#/test-utils/timers.ts'
import {
  LINKED_REPO_ID,
  REPO_ID,
  WORKTREE_BOOTSTRAP_CONFIG_HASH,
  WORKTREE_REPO_ID,
  createLocalRepoWorktreeWithBootstrap,
  mocks,
  removeRepoWorktreeForTest,
  successfulRemovalLifecycle,
} from '#/server/test-utils/repo-module.ts'

describe('repo worktree creation', () => {
  test.each([
    ['pullRepoBranch', async (repo: typeof RepoWritePaths) => repo.pullRepoBranch(REPO_ID, 'feature/a')],
    ['pushRepoBranch', async (repo: typeof RepoWritePaths) => repo.pushRepoBranch(REPO_ID, 'feature/a')],
  ])('%s returns snapshot invalidation impact after success', async (_name, run) => {
    const repo = await import('#/server/modules/repo-write-paths.ts')

    const result = await run(repo)

    expect(result).toMatchObject({ ok: true, message: 'ok' })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID])
  })

  test('createRepoWorktree publishes snapshot invalidations for existing siblings and the new worktree', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-linked', branch: 'feature/b', isBare: false, isPrimary: false },
    ])
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(REPO_ID, {
      worktreePath: '/tmp/repo-worktree',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    })

    expect(result).toMatchObject({ ok: true, message: 'ok' })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID, LINKED_REPO_ID, WORKTREE_REPO_ID])
  })

  test('createRepoWorktree returns timeout failure and invalidates the complete possible impact scope', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-linked', branch: 'feature/b', isBare: false, isPrimary: false },
    ])
    mocks.createWorktree.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'error.worktree-create-timeout-check-state' }, 'timed-out'),
    )
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(REPO_ID, {
      worktreePath: '/tmp/repo-worktree',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    })

    expect(result).toMatchObject({ ok: false, message: 'error.worktree-create-timeout-check-state' })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID, LINKED_REPO_ID, WORKTREE_REPO_ID])
    expect(mocks.bootstrapWorktreeAfterCreate).not.toHaveBeenCalled()
  })

  test('createRepoWorktree does not invalidate when cancellation happened before Git started', async () => {
    mocks.createWorktree.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'cancelled' }, 'not-started'),
    )
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(REPO_ID, {
      worktreePath: '/tmp/repo-worktree',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    })

    expect(result).toMatchObject({ ok: false, message: 'cancelled' })
    expect(result.repoIdsToInvalidate).toBeUndefined()
  })

  test('createRepoWorktree reports uncertain state when cancellation happened after Git started', async () => {
    mocks.createWorktree.mockResolvedValueOnce(commandOutcomeForTest({ ok: false, message: 'cancelled' }, 'cancelled'))
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(REPO_ID, {
      worktreePath: '/tmp/repo-worktree',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    })

    expect(result).toMatchObject({ ok: false, message: 'error.git-command-cancelled-check-state' })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID, WORKTREE_REPO_ID])
  })

  test('createRepoWorktree skips bootstrap unless run is explicitly requested', async () => {
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(REPO_ID, {
      worktreePath: '/tmp/repo-worktree',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    })

    expect(result).toMatchObject({ ok: true, message: 'ok' })
    expect(mocks.bootstrapWorktreeAfterCreate).not.toHaveBeenCalled()
  })

  test('schema rejects run bootstrap decisions without a configTrusted state', async () => {
    const { parseHttpInput } = await import('#/server/common/http-validate.ts')
    const { REPO_PROCEDURE_SCHEMAS } = await import('#/shared/procedure-schemas.ts')

    expect(() =>
      parseHttpInput(REPO_PROCEDURE_SCHEMAS.createWorktree, {
        cwd: '/tmp/repo',
        workspaceRuntimeId: 'runtime-test',
        worktreePath: '/tmp/repo-worktree',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
        worktreeBootstrap: {
          kind: 'run',
          configHash: WORKTREE_BOOTSTRAP_CONFIG_HASH,
        },
      }),
    ).toThrow('worktreeBootstrap')
  })

  test('createRepoWorktree allows one-time bootstrap run requests without trusted repo settings', async () => {
    mocks.setServerWorkspaceWorktreeBootstrapConfigTrust.mockResolvedValueOnce(false)
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createLocalRepoWorktreeWithBootstrap(createRepoWorktree, { configTrusted: false })

    expect(result).toMatchObject({ ok: true, message: 'ok' })
    expect(mocks.createWorktree).toHaveBeenCalled()
    expect(mocks.bootstrapWorktreeAfterCreate).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', {
      signal: undefined,
      expectedConfigHash: WORKTREE_BOOTSTRAP_CONFIG_HASH,
    })
    expect(mocks.setServerWorkspaceWorktreeBootstrapConfigTrust).toHaveBeenCalledWith({
      workspaceId: REPO_ID,
      configHash: WORKTREE_BOOTSTRAP_CONFIG_HASH,
      trusted: false,
    })
    expect(mocks.publishSettingsInvalidation).not.toHaveBeenCalled()
  })

  test('createRepoWorktree preserves the bootstrap summary in its public result', async () => {
    mocks.bootstrapWorktreeAfterCreate.mockResolvedValueOnce({
      ok: true,
      message: 'Copied 1 path: .env',
      worktreeBootstrap: {
        copy: { count: 1, paths: ['.env'] },
        symlink: { count: 0, paths: [] },
        hardlink: { count: 0, paths: [] },
        skippedMissing: { count: 0, paths: [] },
      },
    })
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createLocalRepoWorktreeWithBootstrap(createRepoWorktree, { configTrusted: false })

    expect(result).toMatchObject({
      ok: true,
      message: 'ok\nCopied 1 path: .env',
      worktreeBootstrap: {
        copy: { count: 1, paths: ['.env'] },
        symlink: { count: 0, paths: [] },
        hardlink: { count: 0, paths: [] },
        skippedMissing: { count: 0, paths: [] },
      },
    })
  })

  test('createRepoWorktree clears existing bootstrap trust when the create request leaves trust unchecked', async () => {
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createLocalRepoWorktreeWithBootstrap(createRepoWorktree, { configTrusted: false })

    expect(result).toMatchObject({ ok: true, message: 'ok' })
    expect(mocks.bootstrapWorktreeAfterCreate).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', {
      signal: undefined,
      expectedConfigHash: WORKTREE_BOOTSTRAP_CONFIG_HASH,
    })
    expect(mocks.setServerWorkspaceWorktreeBootstrapConfigTrust).toHaveBeenCalledWith({
      workspaceId: REPO_ID,
      configHash: WORKTREE_BOOTSTRAP_CONFIG_HASH,
      trusted: false,
    })
    expect(mocks.publishSettingsInvalidation).toHaveBeenCalledWith(['settings-snapshot'])
  })

  test('createRepoWorktree reports settings failure when clearing bootstrap trust fails after bootstrap succeeds', async () => {
    mocks.setServerWorkspaceWorktreeBootstrapConfigTrust.mockRejectedValueOnce(new Error('settings write failed'))
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createLocalRepoWorktreeWithBootstrap(createRepoWorktree, { configTrusted: false })

    expect(result).toMatchObject({
      ok: false,
      message: 'settings write failed',
      recoveryMessageKeys: ['error.worktree-created-followup-failed'],
    })
    expect(mocks.setServerWorkspaceWorktreeBootstrapConfigTrust).toHaveBeenCalledWith({
      workspaceId: REPO_ID,
      configHash: WORKTREE_BOOTSTRAP_CONFIG_HASH,
      trusted: false,
    })
    expect(mocks.publishSettingsInvalidation).not.toHaveBeenCalled()
  })

  test('createRepoWorktree stores bootstrap trust after bootstrap succeeds', async () => {
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createLocalRepoWorktreeWithBootstrap(createRepoWorktree, { configTrusted: true })

    expect(result).toMatchObject({ ok: true, message: 'ok' })
    expect(mocks.createWorktree).toHaveBeenCalled()
    expect(mocks.bootstrapWorktreeAfterCreate).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', {
      signal: undefined,
      expectedConfigHash: WORKTREE_BOOTSTRAP_CONFIG_HASH,
    })
    expect(mocks.setServerWorkspaceWorktreeBootstrapConfigTrust).toHaveBeenCalledWith({
      workspaceId: REPO_ID,
      configHash: WORKTREE_BOOTSTRAP_CONFIG_HASH,
      trusted: true,
    })
    expect(mocks.publishSettingsInvalidation).toHaveBeenCalledWith(['settings-snapshot'])
    expect(mocks.bootstrapWorktreeAfterCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setServerWorkspaceWorktreeBootstrapConfigTrust.mock.invocationCallOrder[0],
    )
  })

  test('createRepoWorktree serializes concurrent repo write service operations for the same repo', async () => {
    const configHash = WORKTREE_BOOTSTRAP_CONFIG_HASH
    const firstCreate = Promise.withResolvers<CommandOutcome>()
    const secondCreate = Promise.withResolvers<CommandOutcome>()
    mocks.createWorktree
      .mockImplementationOnce(async () => await firstCreate.promise)
      .mockImplementationOnce(async () => await secondCreate.promise)
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    const first = createRepoWorktree(
      REPO_ID,
      {
        worktreePath: '/tmp/repo-worktree-a',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
      },
      undefined,
      {
        worktreeBootstrap: {
          kind: 'run',
          configHash,
          configTrusted: true,
        },
      },
    )
    await vi.waitFor(() => {
      expect(mocks.createWorktree).toHaveBeenCalledTimes(1)
    })
    expect(
      (await readRepoOperationsSnapshot(REPO_ID)).operations.find(
        (operation) => operation.target?.branch === 'feature/a',
      ),
    ).toMatchObject({
      kind: 'create-worktree',
      phase: 'running',
      target: { branch: 'feature/a', worktreePath: '/tmp/repo-worktree-a' },
    })

    const second = createRepoWorktree(
      REPO_ID,
      {
        worktreePath: '/tmp/repo-worktree-b',
        mode: { kind: 'newBranch', newBranch: 'feature/b', baseRef: 'main' },
      },
      undefined,
      {
        worktreeBootstrap: {
          kind: 'run',
          configHash,
          configTrusted: false,
        },
      },
    )
    await vi.waitFor(async () => {
      expect(
        (await readRepoOperationsSnapshot(REPO_ID)).operations.find(
          (operation) => operation.target?.branch === 'feature/b',
        ),
      ).toMatchObject({ phase: 'queued' })
    })
    expect(mocks.createWorktree).toHaveBeenCalledTimes(1)
    expect(
      (await readRepoOperationsSnapshot(REPO_ID)).operations.find(
        (operation) => operation.target?.branch === 'feature/b',
      ),
    ).toMatchObject({
      kind: 'create-worktree',
      phase: 'queued',
      target: { branch: 'feature/b', worktreePath: '/tmp/repo-worktree-b' },
    })

    firstCreate.resolve(commandOutcomeForTest({ ok: true, message: 'first created' }))
    await expect(first).resolves.toMatchObject({ ok: true, message: 'first created' })
    await flushMicrotasks(2)
    expect(mocks.createWorktree).toHaveBeenCalledTimes(2)

    secondCreate.resolve(commandOutcomeForTest({ ok: true, message: 'second created' }))
    await expect(second).resolves.toMatchObject({ ok: true, message: 'second created' })
    expect((await readRepoOperationsSnapshot(REPO_ID)).operations).toEqual([])
    expect(
      (await readRepoOperationsSnapshot(REPO_ID, { includeSettled: true })).operations.filter(
        (operation) => operation.kind === 'create-worktree',
      ),
    ).toHaveLength(2)

    expect(mocks.createWorktree.mock.calls[0]?.[1]).toMatchObject({ worktreePath: '/tmp/repo-worktree-a' })
    expect(mocks.createWorktree.mock.calls[1]?.[1]).toMatchObject({ worktreePath: '/tmp/repo-worktree-b' })
    expect(mocks.setServerWorkspaceWorktreeBootstrapConfigTrust).toHaveBeenCalledWith({
      workspaceId: REPO_ID,
      configHash,
      trusted: true,
    })
    expect(mocks.setServerWorkspaceWorktreeBootstrapConfigTrust).toHaveBeenCalledWith({
      workspaceId: REPO_ID,
      configHash,
      trusted: false,
    })
    expect(mocks.setServerWorkspaceWorktreeBootstrapConfigTrust.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createWorktree.mock.invocationCallOrder[1],
    )
    expect(mocks.createWorktree.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.setServerWorkspaceWorktreeBootstrapConfigTrust.mock.invocationCallOrder[1],
    )
  })

  test('repo write service operations serialize across mutation kinds for the same repo', async () => {
    const firstDelete = Promise.withResolvers<CommandOutcome>()
    const secondRemove = Promise.withResolvers<CommandOutcome>()
    mocks.resolveRepoCommonDir.mockResolvedValue('/tmp/repo/.git')
    mocks.readWorktreeMembership.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/b',
        isBare: false,
        isPrimary: false,
      },
    ])
    mocks.deleteBranch.mockImplementationOnce(async () => await firstDelete.promise)
    mocks.removeWorktree.mockImplementationOnce(async () => await secondRemove.promise)
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    const first = deleteRepoBranch(REPO_ID, 'feature/a')
    await vi.waitFor(() => {
      expect(mocks.deleteBranch).toHaveBeenCalledTimes(1)
    })
    expect(
      (await readRepoOperationsSnapshot(REPO_ID)).operations.find((operation) => operation.kind === 'delete-branch'),
    ).toMatchObject({
      kind: 'delete-branch',
      phase: 'running',
      target: { branch: 'feature/a' },
    })

    const second = removeRepoWorktreeForTest(
      REPO_ID,
      {
        branch: 'feature/b',
        worktreePath: '/tmp/repo-worktree',
        deleteBranch: false,
      },
      successfulRemovalLifecycle,
    )
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
    await vi.waitFor(async () => {
      expect(
        (await readRepoOperationsSnapshot(REPO_ID)).operations.find(
          (operation) => operation.kind === 'remove-worktree',
        ),
      ).toMatchObject({
        kind: 'remove-worktree',
        phase: 'queued',
        target: { branch: 'feature/b', worktreePath: '/tmp/repo-worktree' },
      })
    })

    firstDelete.resolve(commandOutcomeForTest({ ok: true, message: 'deleted' }))
    await expect(first).resolves.toMatchObject({ ok: true, message: 'deleted' })
    await vi.waitFor(() => {
      expect(mocks.removeWorktree).toHaveBeenCalledTimes(1)
    })

    secondRemove.resolve(commandOutcomeForTest({ ok: true, message: 'removed' }))
    await expect(second).resolves.toMatchObject({ ok: true, message: 'removed' })
    expect((await readRepoOperationsSnapshot(REPO_ID)).operations).toEqual([])
  })

  test('repo write service operations serialize linked worktree repo ids by common git dir', async () => {
    const firstDelete = Promise.withResolvers<CommandOutcome>()
    const secondRemove = Promise.withResolvers<CommandOutcome>()
    mocks.resolveRepoCommonDir.mockImplementation(async (cwd: string) =>
      cwd === '/tmp/repo' || cwd === '/tmp/repo-linked' ? '/tmp/repo/.git' : `${cwd}/.git`,
    )
    mocks.readWorktreeMembership.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      {
        path: '/tmp/repo-linked',
        branch: 'feature/b',
        isBare: false,
        isPrimary: false,
      },
    ])
    mocks.deleteBranch.mockImplementationOnce(async () => await firstDelete.promise)
    mocks.removeWorktree.mockImplementationOnce(async () => await secondRemove.promise)
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')
    const { resolveRepoWriteBoundaryForRead } = await import('#/server/modules/repo-write-operation-coordinator.ts')
    await resolveRepoWriteBoundaryForRead(LINKED_REPO_ID)

    const first = deleteRepoBranch(REPO_ID, 'feature/a')
    await vi.waitFor(() => {
      expect(mocks.deleteBranch).toHaveBeenCalledTimes(1)
    })
    await expect(readRepoOperationsSnapshot(LINKED_REPO_ID)).resolves.toMatchObject({
      operations: [
        expect.objectContaining({
          repoId: REPO_ID,
          kind: 'delete-branch',
          phase: 'running',
          target: { branch: 'feature/a' },
        }),
      ],
    })

    const second = removeRepoWorktreeForTest(
      LINKED_REPO_ID,
      {
        branch: 'feature/b',
        worktreePath: '/tmp/repo-linked',
        deleteBranch: false,
      },
      successfulRemovalLifecycle,
    )
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
    await vi.waitFor(async () => {
      expect(
        (await readRepoOperationsSnapshot(LINKED_REPO_ID)).operations.find(
          (operation) => operation.kind === 'remove-worktree',
        ),
      ).toMatchObject({
        kind: 'remove-worktree',
        phase: 'queued',
        target: { branch: 'feature/b', worktreePath: '/tmp/repo-linked' },
      })
    })

    firstDelete.resolve(commandOutcomeForTest({ ok: true, message: 'deleted' }))
    await expect(first).resolves.toMatchObject({ ok: true, message: 'deleted' })
    await vi.waitFor(() => {
      expect(mocks.removeWorktree).toHaveBeenCalledTimes(1)
    })

    expect(mocks.removeWorktree).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-linked', undefined)
    secondRemove.resolve(commandOutcomeForTest({ ok: true, message: 'removed' }))
    await expect(second).resolves.toMatchObject({ ok: true, message: 'removed' })
  })

  test('repo write service operations serialize linked worktree network mutations by common git dir', async () => {
    const firstDelete = Promise.withResolvers<CommandOutcome>()
    const secondPull = Promise.withResolvers<CommandOutcome>()
    mocks.resolveRepoCommonDir.mockImplementation(async (cwd: string) =>
      cwd === '/tmp/repo' || cwd === '/tmp/repo-linked' ? '/tmp/repo/.git' : `${cwd}/.git`,
    )
    mocks.deleteBranch.mockImplementationOnce(async () => await firstDelete.promise)
    mocks.pullBranch.mockImplementationOnce(async () => await secondPull.promise)
    const { deleteRepoBranch, pullRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const first = deleteRepoBranch(REPO_ID, 'feature/a')
    await vi.waitFor(() => {
      expect(mocks.deleteBranch).toHaveBeenCalledTimes(1)
    })

    const second = pullRepoBranch(LINKED_REPO_ID, 'feature/b')
    await flushMicrotasks(2)

    expect(mocks.pullBranch).not.toHaveBeenCalled()

    firstDelete.resolve(commandOutcomeForTest({ ok: true, message: 'deleted' }))
    await expect(first).resolves.toMatchObject({ ok: true, message: 'deleted' })
    await vi.waitFor(() => {
      expect(mocks.pullBranch).toHaveBeenCalledTimes(1)
    })

    secondPull.resolve(commandOutcomeForTest({ ok: true, message: 'pulled' }))
    await expect(second).resolves.toMatchObject({ ok: true, message: 'pulled' })
  })

  test('createRepoWorktree reports settings failure after creating and bootstrapping the worktree', async () => {
    mocks.setServerWorkspaceWorktreeBootstrapConfigTrust.mockRejectedValueOnce(new Error('settings write failed'))
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createLocalRepoWorktreeWithBootstrap(createRepoWorktree, { configTrusted: true })

    expect(result).toMatchObject({
      ok: false,
      message: 'settings write failed',
      recoveryMessageKeys: ['error.worktree-created-followup-failed'],
    })
    expect(mocks.createWorktree).toHaveBeenCalled()
    expect(mocks.bootstrapWorktreeAfterCreate).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', {
      signal: undefined,
      expectedConfigHash: WORKTREE_BOOTSTRAP_CONFIG_HASH,
    })
    expect(mocks.publishSettingsInvalidation).not.toHaveBeenCalled()
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID, WORKTREE_REPO_ID])
    expect(mocks.setServerWorkspaceWorktreeBootstrapConfigTrust).toHaveBeenCalledTimes(1)
  })
})
