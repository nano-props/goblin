// @vitest-environment jsdom

import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { PullRequestStatusRow } from '#/web/components/repo-workspace/PullRequestStatusRow.tsx'
import { openBranchExternalTarget } from '#/web/hooks/openBranchExternalTarget.ts'
import { createPullRequest } from '#/web/test-utils/repo-store.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

// Pass-through i18n with minimal translations for the keys this component
// reads at render time. The stub interpolates `{name}` placeholders from
// `params` so `prSummary` produces a real "#178 · open" string.
const TEST_DICT: Record<string, string> = {
  'branch-status.pr.open': 'open',
  'branch-status.pr.draft': 'draft',
  'branch-status.pr.merged': 'merged',
  'branch-status.pr.closed': 'closed',
  'branch-status.pr.summary': '#{n} · {state}',
  'branch-status.pr.copy-link': 'Copy PR link',
  'branch-status.pr.open-externally': 'Open pull request in browser',
  'branch-status.signal.pr': 'PR',
  'branch-status.copied': 'Copied',
  'branch-status.pr.pending': 'loading',
  'branch-status.pr.unavailable': 'unavailable',
  'branch-status.pr.failed': 'could not load',
  'branch-status.pr.none': 'none',
  'error.try-again': 'Try again',
}

vi.mock('#/web/stores/i18n.ts', () => ({
  useI18nStore: () => ({ lang: 'en' }),
  useT: () => (key: string, params?: Record<string, string | number>) => {
    const template = TEST_DICT[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`))
  },
}))

vi.mock('#/web/hooks/openBranchExternalTarget.ts', () => ({
  openBranchExternalTarget: vi.fn(async () => ({ ok: true, message: '' })),
}))

const openExternalMock = vi.mocked(openBranchExternalTarget)

const REPO_ID = workspaceIdForTest('goblin+file:///workspace')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-pr-row-test'
const BRANCH_NAME = 'feature/pr'

beforeEach(() => {
  openExternalMock.mockClear()
})

describe('PullRequestStatusRow', () => {
  test.each([
    ['pending', 'loading'],
    ['unavailable', 'unavailable'],
    ['empty', 'none'],
  ] as const)('renders the local %s state without treating it as a PR result', (state, label) => {
    renderInJsdom(
      <PullRequestStatusRow
        repoId={REPO_ID}
        workspaceRuntimeId={WORKSPACE_RUNTIME_ID}
        branchName={BRANCH_NAME}
        pullRequest={undefined}
        read={{ state, error: null, retrying: false, retry: vi.fn() }}
      />,
    )

    expect(document.body.textContent).toContain(label)
    expect(document.querySelector('[data-pull-request-link]')).toBeNull()
  })

  test('renders a retryable local error state', () => {
    const retry = vi.fn()
    renderInJsdom(
      <PullRequestStatusRow
        repoId={REPO_ID}
        workspaceRuntimeId={WORKSPACE_RUNTIME_ID}
        branchName={BRANCH_NAME}
        pullRequest={undefined}
        read={{ state: 'error', error: 'error.failed-read-repo', retrying: false, retry }}
      />,
    )

    fireEvent.click(document.querySelector<HTMLButtonElement>('button')!)
    expect(document.body.textContent).toContain('could not load')
    expect(retry).toHaveBeenCalledOnce()
  })

  test('renders the PR summary chip as a clickable button', () => {
    const pullRequest = createPullRequest(178, {
      state: 'open',
      url: 'https://github.com/acme/repo/pull/178',
    })
    renderInJsdom(
      <PullRequestStatusRow
        repoId={REPO_ID}
        workspaceRuntimeId={WORKSPACE_RUNTIME_ID}
        branchName={BRANCH_NAME}
        pullRequest={pullRequest}
        read={{ state: 'ready', error: null, retrying: false, retry: vi.fn() }}
      />,
    )

    const chip = document.querySelector<HTMLButtonElement>('[data-pull-request-link]')
    expect(chip).not.toBeNull()
    expect(chip?.tagName).toBe('BUTTON')
    expect(chip?.type).toBe('button')
    expect(chip?.textContent).toContain('#178')
    // No underline styling — the clickable variant must mirror the
    // existing chip look so it slots into the row without a visual seam.
    expect(chip?.className ?? '').not.toMatch(/\bunderline\b/)
  })

  test('clicking the chip routes through openBranchExternalTarget', () => {
    const pullRequest = createPullRequest(105, {
      state: 'open',
      isDraft: true,
      url: 'https://github.com/acme/repo/pull/105',
    })
    renderInJsdom(
      <PullRequestStatusRow
        repoId={REPO_ID}
        workspaceRuntimeId={WORKSPACE_RUNTIME_ID}
        branchName={BRANCH_NAME}
        pullRequest={pullRequest}
        read={{ state: 'ready', error: null, retrying: false, retry: vi.fn() }}
      />,
    )

    const chip = document.querySelector<HTMLButtonElement>('[data-pull-request-link]')!
    fireEvent.click(chip)

    expect(openExternalMock).toHaveBeenCalledTimes(1)
    expect(openExternalMock).toHaveBeenCalledWith(REPO_ID, WORKSPACE_RUNTIME_ID, { name: BRANCH_NAME, pullRequest })
  })

  test('absorbs accidental double-clicks within the latch window', () => {
    useFakeTimers()
    const pullRequest = createPullRequest(178, {
      state: 'open',
      url: 'https://github.com/acme/repo/pull/178',
    })
    renderInJsdom(
      <PullRequestStatusRow
        repoId={REPO_ID}
        workspaceRuntimeId={WORKSPACE_RUNTIME_ID}
        branchName={BRANCH_NAME}
        pullRequest={pullRequest}
        read={{ state: 'ready', error: null, retrying: false, retry: vi.fn() }}
      />,
    )

    const chip = document.querySelector<HTMLButtonElement>('[data-pull-request-link]')!
    fireEvent.click(chip)
    fireEvent.click(chip)
    fireEvent.click(chip)

    expect(openExternalMock).toHaveBeenCalledTimes(1)

    // Once the latch expires (500ms) a fresh click should fire again.
    vi.advanceTimersByTime(500)
    fireEvent.click(chip)

    expect(openExternalMock).toHaveBeenCalledTimes(2)
  })
})
