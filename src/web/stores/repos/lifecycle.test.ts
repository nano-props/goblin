import { beforeEach, describe, expect, test, vi } from 'vitest'
import { normalizeRemoteTarget, remoteRepoSessionEntry } from '#/shared/remote-repo.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { BranchSnapshotInfo } from '#/web/types.ts'
import {
  branchSnapshot,
  flushIpc,
  installGoblin,
  REPO_A,
  REPO_B,
  resetLifecycleTest,
} from '#/web/stores/repos/lifecycle-test-utils.ts'

beforeEach(resetLifecycleTest)

describe('repo lifecycle', () => {
  test('ensureWorkspaceOpen plus setActive opens the resolved repo, records it as recent, and starts initial local refresh', async () => {
    const calls = installGoblin()

    const result = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (result.ok) useReposStore.getState().setActive(result.id)

    expect(result).toEqual({ ok: true, id: REPO_A })
    expect(useReposStore.getState().order).toEqual([REPO_A])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    expect(calls.recent).toEqual([{ kind: 'local', id: REPO_A }])
    await vi.waitFor(() => {
      expect(calls.composite).toEqual([REPO_A])
    })
  })

  test('ensureWorkspaceOpen adds a repo to the open set without changing the active selection', async () => {
    const calls = installGoblin()

    const first = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (first.ok) useReposStore.getState().setActive(first.id)
    const result = await useReposStore.getState().ensureWorkspaceOpen(REPO_B)

    expect(result).toEqual({ ok: true, id: REPO_B })
    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    await vi.waitFor(() => {
      expect(calls.composite).toEqual([REPO_A, REPO_B])
    })
  })

  test('ensureWorkspaceOpen opens without changing the active repo', async () => {
    const calls = installGoblin()

    const first = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (first.ok) useReposStore.getState().setActive(first.id)
    await useReposStore.getState().ensureWorkspaceOpen(REPO_B)

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    await vi.waitFor(() => {
      expect(calls.composite).toEqual([REPO_A, REPO_B])
    })
  })

  test('ensureWorkspaceOpen still ensures the workspace is added to the open set', async () => {
    installGoblin()

    const first = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (first.ok) useReposStore.getState().setActive(first.id)
    await useReposStore.getState().ensureWorkspaceOpen(REPO_B)

    expect(Object.keys(useReposStore.getState().repos)).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
  })

  test('ensureWorkspaceOpen does not re-refresh an already-open repo with unchanged target', async () => {
    const calls = installGoblin()

    const first = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (first.ok) useReposStore.getState().setActive(first.id)
    const second = await useReposStore.getState().ensureWorkspaceOpen(REPO_B)
    if (second.ok) useReposStore.getState().setActive(second.id)
    // Opening REPO_A again is a focus action: the repo is already
    // resolved and its data is coherent, so we skip the snapshot/status
    // pipeline. (hydrateSession still always refreshes on boot — see
    // the lifecycle-hydrate test for the cached-then-fresh contract.)
    const third = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (third.ok) useReposStore.getState().setActive(third.id)

    expect(useReposStore.getState().order).toEqual([REPO_A, REPO_B])
    expect(useReposStore.getState().activeId).toBe(REPO_A)
    await vi.waitFor(() => {
      expect(calls.composite).toEqual([REPO_A, REPO_B])
    })
  })
  test('initial refresh results from a closed repo instance do not overwrite a reopened repo', async () => {
    const snapshotResolvers: Array<(value: { branches: BranchSnapshotInfo[]; current: string }) => void> = []
    installGoblin({
      snapshot: () =>
        new Promise<{ branches: BranchSnapshotInfo[]; current: string }>((resolve) => {
          snapshotResolvers.push(resolve)
        }),
      // `refreshCoreData` now goes through the composite endpoint, so
      // forward every snapshot resolver into the composite handler too.
      composite: () =>
        new Promise<{
          snapshot: { branches: BranchSnapshotInfo[]; current: string }
          status: never[]
          pullRequests: null
        }>((resolve) => {
          snapshotResolvers.push((value) => resolve({ snapshot: value, status: [], pullRequests: null }))
        }),
    })

    const first = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (first.ok) useReposStore.getState().setActive(first.id)
    const firstToken = useReposStore.getState().repos[REPO_A]?.instanceToken
    useReposStore.getState().closeRepo(REPO_A)
    const second = await useReposStore.getState().ensureWorkspaceOpen(REPO_A)
    if (second.ok) useReposStore.getState().setActive(second.id)
    const secondToken = useReposStore.getState().repos[REPO_A]?.instanceToken

    snapshotResolvers[1]?.({ branches: [branchSnapshot('fresh')], current: 'fresh' })
    await flushIpc()

    expect(secondToken).not.toBe(firstToken)
    await vi.waitFor(() => {
      expect(useReposStore.getState().repos[REPO_A]?.data.currentBranch).toBe('fresh')
    })

    snapshotResolvers[0]?.({ branches: [branchSnapshot('stale')], current: 'stale' })
    await flushIpc()

    expect(useReposStore.getState().repos[REPO_A]?.data.currentBranch).toBe('fresh')
  })

  test('ensureWorkspaceOpen preserves remote target metadata for recent repos and later actions', async () => {
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

    const result = await useReposStore.getState().ensureWorkspaceOpen(remoteRepoSessionEntry(target!))

    expect(result).toEqual({ ok: true, id: target!.id })
    expect(useReposStore.getState().repos[target!.id]?.remote.target).toEqual(target)
    expect(calls.recent).toEqual([remoteRepoSessionEntry(target!)])
  })

  test('ensureWorkspaceOpen refreshes when a remote target changes between opens', async () => {
    const oldTarget = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    const newTarget = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.org',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
    })
    expect(oldTarget).not.toBeNull()
    expect(newTarget).not.toBeNull()

    // The default IPC mock hardcodes the host by alias, so a same-alias
    // re-open would never see a target change. Override resolveTarget
    // to return oldTarget on the first call and newTarget on the second.
    let resolveCalls = 0
    installGoblin({
      probe: (cwd: string) => ({ ok: true, root: cwd, name: 'repo' }),
      'remote.resolveTarget': () => {
        resolveCalls += 1
        return { target: resolveCalls === 1 ? oldTarget : newTarget }
      },
    })

    const first = await useReposStore
      .getState()
      .ensureWorkspaceOpen(remoteRepoSessionEntry(oldTarget!))
    expect(first).toEqual({ ok: true, id: oldTarget!.id })
    expect(useReposStore.getState().repos[oldTarget!.id]?.remote.target).toEqual(oldTarget)

    // Second open with a different SSH host. The target update must
    // trigger a refresh — the previous build returned `changed: false`
    // for the in-place update, so this assertion would have failed.
    const calls = installGoblin({
      probe: (cwd: string) => ({ ok: true, root: cwd, name: 'repo' }),
      'remote.resolveTarget': () => ({ target: newTarget }),
    })
    const second = await useReposStore
      .getState()
      .ensureWorkspaceOpen(remoteRepoSessionEntry(newTarget!))
    expect(second).toEqual({ ok: true, id: newTarget!.id })
    expect(useReposStore.getState().repos[newTarget!.id]?.remote.target).toEqual(newTarget)
    expect(calls.composite).toEqual([newTarget!.id])
  })
})
