// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openBranchExternalTarget, openUpstreamBranchExternalTarget } from '#/web/hooks/openBranchExternalTarget.ts'

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

const REPO_ID = '/tmp/gbl-open-upstream-test'

beforeEach(() => {
  mocks.openExternalUrl.mockReset()
  mocks.openRepoUrl.mockReset()
})

describe('openBranchExternalTarget', () => {
  test('prefers the existing pull request URL', async () => {
    mocks.openExternalUrl.mockResolvedValue({ ok: true, message: '' })

    await openBranchExternalTarget(REPO_ID, {
      name: 'feature/pr',
      pullRequest: { url: 'https://github.com/acme/repo/pull/1', number: 1 } as never,
    })

    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://github.com/acme/repo/pull/1')
    expect(mocks.openRepoUrl).not.toHaveBeenCalled()
  })

  test('falls back to the branch remote target when no pull request exists', async () => {
    mocks.openRepoUrl.mockResolvedValue({ ok: true, message: '' })

    await openBranchExternalTarget(REPO_ID, { name: 'feature/no-pr', pullRequest: undefined })

    expect(mocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, { type: 'branch', branch: 'feature/no-pr' })
    expect(mocks.openExternalUrl).not.toHaveBeenCalled()
  })
})

describe('openUpstreamBranchExternalTarget', () => {
  test('parses `remote/branch` and opens the named remote', async () => {
    mocks.openRepoUrl.mockResolvedValue({ ok: true, message: '' })

    await openUpstreamBranchExternalTarget(REPO_ID, 'origin/main')

    expect(mocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, {
      type: 'branch',
      branch: 'main',
      remote: 'origin',
    })
  })

  test('preserves slashes in the branch name', async () => {
    mocks.openRepoUrl.mockResolvedValue({ ok: true, message: '' })

    await openUpstreamBranchExternalTarget(REPO_ID, 'origin/feature/foo')

    expect(mocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, {
      type: 'branch',
      branch: 'feature/foo',
      remote: 'origin',
    })
  })

  test('rejects malformed tracking refs without calling openRepoUrl', async () => {
    const result = await openUpstreamBranchExternalTarget(REPO_ID, 'no-slash')
    expect(result.ok).toBe(false)
    expect(mocks.openRepoUrl).not.toHaveBeenCalled()
  })

  test('rejects empty branch segments', async () => {
    const trailingSlash = await openUpstreamBranchExternalTarget(REPO_ID, 'origin/')
    const leadingSlash = await openUpstreamBranchExternalTarget(REPO_ID, '/main')
    expect(trailingSlash.ok).toBe(false)
    expect(leadingSlash.ok).toBe(false)
    expect(mocks.openRepoUrl).not.toHaveBeenCalled()
  })
})
