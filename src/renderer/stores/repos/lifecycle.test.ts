import { beforeEach, describe, expect, test } from 'vitest'
import { normalizeRemoteTarget, remoteRepoSessionEntry } from '#/shared/remote-repo.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { BranchSnapshotInfo } from '#/renderer/types.ts'
import {
  branchSnapshot,
  flushRpc,
  installGoblin,
  REPO_A,
  REPO_B,
  resetLifecycleTest,
} from '#/renderer/stores/repos/lifecycle-test-utils.ts'

beforeEach(resetLifecycleTest)

describe('repo lifecycle', () => {
  test('openRepo opens the resolved repo, records it as recent, and starts initial local refresh', async () => {
    const calls = installGoblin()

    const result = await useReposStore.getState().openRepo(REPO_A)

    expect(result).toEqual({ ok: true, id: REPO_A })
    expect(useReposStore.getState().order).toEqual([REPO_A])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    expect(calls.recent).toEqual([{ kind: 'local', id: REPO_A }])
    expect(calls.snapshot).toEqual([REPO_A])
    expect(calls.status).toEqual([REPO_A])
  })

  test('openRepo with activate false opens without changing the active repo', async () => {
    const calls = installGoblin()

    await useReposStore.getState().openRepo(REPO_A)
    await useReposStore.getState().openRepo(REPO_B, { activate: false })

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    expect(calls.snapshot).toEqual([REPO_A, REPO_B])
    expect(calls.status).toEqual([REPO_A, REPO_B])
  })

  test('openRepo activates and locally refreshes an already-open repo', async () => {
    const calls = installGoblin()

    await useReposStore.getState().openRepo(REPO_A)
    await useReposStore.getState().openRepo(REPO_B)
    await useReposStore.getState().openRepo(REPO_A)

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    expect(calls.snapshot).toEqual([REPO_A, REPO_B, REPO_A])
    expect(calls.status).toEqual([REPO_A, REPO_B, REPO_A])
  })
  test('initial refresh results from a closed repo instance do not overwrite a reopened repo', async () => {
    const snapshotResolvers: Array<(value: { branches: BranchSnapshotInfo[]; current: string }) => void> = []
    installGoblin({
      snapshot: () =>
        new Promise<{ branches: BranchSnapshotInfo[]; current: string }>((resolve) => {
          snapshotResolvers.push(resolve)
        }),
    })

    await useReposStore.getState().openRepo(REPO_A)
    const firstToken = useReposStore.getState().repos[REPO_A]?.instanceToken
    useReposStore.getState().closeRepo(REPO_A)
    await useReposStore.getState().openRepo(REPO_A)
    const secondToken = useReposStore.getState().repos[REPO_A]?.instanceToken

    snapshotResolvers[1]?.({ branches: [branchSnapshot('fresh')], current: 'fresh' })
    await flushRpc()

    expect(secondToken).not.toBe(firstToken)
    expect(useReposStore.getState().repos[REPO_A]?.data.currentBranch).toBe('fresh')

    snapshotResolvers[0]?.({ branches: [branchSnapshot('stale')], current: 'stale' })
    await flushRpc()

    expect(useReposStore.getState().repos[REPO_A]?.data.currentBranch).toBe('fresh')
  })

  test('openRepo preserves remote target metadata for recent repos and later actions', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(target).not.toBeNull()
    const calls = installGoblin({
      probe: (cwd: string) => ({ ok: true, root: cwd, name: 'repo' }),
    })

    const result = await useReposStore.getState().openRepo(remoteRepoSessionEntry(target!))

    expect(result).toEqual({ ok: true, id: target!.id })
    expect(useReposStore.getState().repos[target!.id]?.remote.target).toEqual(target)
    expect(calls.recent).toEqual([remoteRepoSessionEntry(target!)])
  })
})
