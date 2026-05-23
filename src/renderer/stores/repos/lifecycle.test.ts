import { beforeEach, describe, expect, test } from 'vitest'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { BranchInfo } from '#/renderer/types.ts'
import {
  branch,
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
    expect(calls.recent).toEqual([REPO_A])
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
    const snapshotResolvers: Array<(value: { branches: BranchInfo[]; current: string }) => void> = []
    installGoblin({
      snapshot: () =>
        new Promise<{ branches: BranchInfo[]; current: string }>((resolve) => {
          snapshotResolvers.push(resolve)
        }),
    })

    await useReposStore.getState().openRepo(REPO_A)
    const firstToken = useReposStore.getState().repos[REPO_A]?.instanceToken
    useReposStore.getState().closeRepo(REPO_A)
    await useReposStore.getState().openRepo(REPO_A)
    const secondToken = useReposStore.getState().repos[REPO_A]?.instanceToken

    snapshotResolvers[1]?.({ branches: [branch('fresh')], current: 'fresh' })
    await flushRpc()

    expect(secondToken).not.toBe(firstToken)
    expect(useReposStore.getState().repos[REPO_A]?.data.currentBranch).toBe('fresh')

    snapshotResolvers[0]?.({ branches: [branch('stale')], current: 'stale' })
    await flushRpc()

    expect(useReposStore.getState().repos[REPO_A]?.data.currentBranch).toBe('fresh')
  })
})
