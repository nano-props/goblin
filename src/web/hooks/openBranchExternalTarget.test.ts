// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openBranchExternalTarget, openUpstreamBranchExternalTarget } from '#/web/hooks/openBranchExternalTarget.ts'
import { resetWorkspacesStore, seedRepoShellForTest } from '#/web/test-utils/bridge.ts'

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
  openRepoUrl: vi.fn(),
}))

vi.mock('#/web/app-shell-client.ts', () => ({
  openExternalUrl: mocks.openExternalUrl,
}))

vi.mock('#/web/repo-client.ts', () => ({
  openRepoUrl: mocks.openRepoUrl,
}))

const REPO_ID = 'goblin+file:///tmp/goblin-open-upstream-test'
const WORKSPACE_RUNTIME_ID = 'repo-runtime-open-upstream-test'

beforeEach(() => {
  resetWorkspacesStore()
  mocks.openExternalUrl.mockReset()
  mocks.openRepoUrl.mockReset()
})

describe('openBranchExternalTarget', () => {
  test('prefers the existing pull request URL', async () => {
    mocks.openExternalUrl.mockResolvedValue({ ok: true, message: '' })

    await openBranchExternalTarget(REPO_ID, WORKSPACE_RUNTIME_ID, {
      name: 'feature/pr',
      pullRequest: { url: 'https://github.com/acme/repo/pull/1', number: 1 } as never,
    })

    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://github.com/acme/repo/pull/1')
    expect(mocks.openRepoUrl).not.toHaveBeenCalled()
  })

  test('falls back to the branch remote target when no pull request exists', async () => {
    mocks.openRepoUrl.mockResolvedValue({ ok: true, message: '' })

    await openBranchExternalTarget(REPO_ID, WORKSPACE_RUNTIME_ID, { name: 'feature/no-pr', pullRequest: undefined })

    expect(mocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, WORKSPACE_RUNTIME_ID, {
      type: 'branch',
      branch: 'feature/no-pr',
    })
    expect(mocks.openExternalUrl).not.toHaveBeenCalled()
  })
})

describe('openUpstreamBranchExternalTarget', () => {
  test('parses `remote/branch` and opens the named remote', async () => {
    mocks.openRepoUrl.mockResolvedValue({ ok: true, message: '' })
    seedRepoShellForTest({ id: REPO_ID, remote: { remotes: ['origin'] } })

    await openUpstreamBranchExternalTarget(REPO_ID, WORKSPACE_RUNTIME_ID, 'origin/main')

    expect(mocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, WORKSPACE_RUNTIME_ID, {
      type: 'branch',
      branch: 'main',
      remote: 'origin',
    })
  })

  test('preserves slashes in the branch name', async () => {
    mocks.openRepoUrl.mockResolvedValue({ ok: true, message: '' })
    seedRepoShellForTest({ id: REPO_ID, remote: { remotes: ['origin'] } })

    await openUpstreamBranchExternalTarget(REPO_ID, WORKSPACE_RUNTIME_ID, 'origin/feature/foo')

    expect(mocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, WORKSPACE_RUNTIME_ID, {
      type: 'branch',
      branch: 'feature/foo',
      remote: 'origin',
    })
  })

  test('uses the longest matching remote name when remote names contain slashes', async () => {
    mocks.openRepoUrl.mockResolvedValue({ ok: true, message: '' })
    seedRepoShellForTest({
      id: REPO_ID,
      remote: {
        remotes: ['origin', 'origin/team'],
        remoteProviders: { origin: 'github', 'origin/team': 'gitlab' },
      },
    })

    await openUpstreamBranchExternalTarget(REPO_ID, WORKSPACE_RUNTIME_ID, 'origin/team/main')

    expect(mocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, WORKSPACE_RUNTIME_ID, {
      type: 'branch',
      branch: 'main',
      remote: 'origin/team',
    })
  })

  test('rejects malformed tracking refs without calling openRepoUrl', async () => {
    const result = await openUpstreamBranchExternalTarget(REPO_ID, WORKSPACE_RUNTIME_ID, 'no-slash')
    expect(result.ok).toBe(false)
    expect(mocks.openRepoUrl).not.toHaveBeenCalled()
  })

  test('rejects empty branch segments', async () => {
    const trailingSlash = await openUpstreamBranchExternalTarget(REPO_ID, WORKSPACE_RUNTIME_ID, 'origin/')
    const leadingSlash = await openUpstreamBranchExternalTarget(REPO_ID, WORKSPACE_RUNTIME_ID, '/main')
    expect(trailingSlash.ok).toBe(false)
    expect(leadingSlash.ok).toBe(false)
    expect(mocks.openRepoUrl).not.toHaveBeenCalled()
  })
})
