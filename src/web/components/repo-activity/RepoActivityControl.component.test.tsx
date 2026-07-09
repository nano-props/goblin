// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { RepoActivityControl } from '#/web/components/repo-activity/RepoActivityControl.tsx'
import { resetReposStore, seedRepoShellForTest } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { markRepoOperationTargets, nextRepoOperationId } from '#/web/stores/repos/repo-operation-scheduler.ts'
import { setRepoOperationsQueryData } from '#/web/repo-data-query.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import type { RepoServerOperationState } from '#/shared/api-types.ts'

const REPO_ID = '/tmp/repo-activity-control-component'

beforeEach(() => {
  resetReposStore()
  // Empty dict so `t('key')` returns the key itself — lets the test
  // assert the exact key the tooltip wires up, independent of the
  // dictionary snapshot (which is hydrated over IPC in production).
  useI18nStore.setState({
    lang: 'en',
    pref: 'auto',
    dict: {},
    hydrate: async () => {},
    setPref: async () => {},
  })
})

describe('RepoActivityControl component', () => {
  test('disables the primary refresh button while server projection reports a user fetch', () => {
    const repo = seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: true } })
    setRepoOperationsQueryData(REPO_ID, repo.repoRuntimeId, false, {
      operations: [serverOperation(repo.repoRuntimeId, { kind: 'fetch', phase: 'running', source: 'user' })],
      loadedAt: 123,
    })

    const { container } = renderControl()

    expect(button(container).disabled).toBe(true)
    expect(button(container).getAttribute('aria-busy')).toBe('true')
  })

  test('keeps the primary refresh button idle while server projection reports a background fetch', () => {
    const repo = seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: true } })
    setRepoOperationsQueryData(REPO_ID, repo.repoRuntimeId, false, {
      operations: [serverOperation(repo.repoRuntimeId, { kind: 'fetch', phase: 'running', source: 'background' })],
      loadedAt: 123,
    })

    const { container } = renderControl()

    expect(button(container).disabled).toBe(false)
    expect(button(container).getAttribute('aria-busy')).toBeNull()
  })

  test('renders branch action activity from server operation projection', async () => {
    const repo = seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: true } })
    setRepoOperationsQueryData(REPO_ID, repo.repoRuntimeId, false, {
      operations: [
        serverOperation(repo.repoRuntimeId, {
          kind: 'push',
          phase: 'queued',
          source: 'user',
          branch: 'feature/a',
        }),
      ],
      loadedAt: 123,
    })

    const { container } = renderControl()

    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 150))
    })

    expect(container.textContent).toContain('action.push-queued')
    expect(button(container).getAttribute('aria-busy')).toBe('true')
  })

  test('keeps the primary refresh button enabled during background-blocked refresh states', () => {
    seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: true } })
    markRepoOperationTargets(REPO_ID, nextRepoOperationId(REPO_ID), [{ key: 'visibleStatus', reason: 'visible-status' }], 'running')

    const { container } = renderControl()

    expect(button(container).disabled).toBe(false)
    expect(button(container).getAttribute('aria-busy')).toBeNull()
  })

  test('disables the primary refresh button during manual refreshes', () => {
    seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: true } })
    markRepoOperationTargets(
      REPO_ID,
      nextRepoOperationId(REPO_ID),
      [{ key: 'manualRefresh', reason: 'manual-refresh' }],
      'running',
    )

    const { container } = renderControl()

    expect(button(container).disabled).toBe(true)
    expect(button(container).getAttribute('aria-busy')).toBe('true')
  })

  test('renders the primary refresh button for local-only repositories without the local-only label', () => {
    seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: false } })

    const { container } = renderControl()

    expect(button(container).disabled).toBe(false)
    expect(container.textContent).not.toContain('tab.local-only')
  })

  test('shows the last-sync time in the refresh button tooltip when fetch has loaded', async () => {
    const loadedAt = Date.now() - 5_000
    const repo = seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: true } })
    useReposStore.setState((state) => ({
      repos: {
        ...state.repos,
        [REPO_ID]: {
          ...repo,
          // Use the fetch data load since `latestRepoSyncTime` reads
          // `dataLoads.fetch.loadedAt` directly; setting the read model
          // requires `projection.source === 'fresh'` which would also
          // work but couples this test to a second code path.
          dataLoads: {
            ...repo.dataLoads,
            fetch: { ...repo.dataLoads.fetch, loadedAt },
          },
        },
      },
    }))

    const { container } = renderControl()

    const tooltip = await openTooltip(button(container))
    // The tooltip should be a single line (no separator), starting
    // with the "Last synced" label, and the relative time should be
    // present (date-fns renders "5 seconds ago" in en).
    expect(tooltip.textContent).toContain('repo-picker.tooltip.last-sync-label')
    expect(tooltip.textContent).toMatch(/5\s+seconds?/)
  })

  test('falls back to the fetch action title in the refresh button tooltip before the first sync', async () => {
    seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: true } })

    const { container } = renderControl()

    const tooltip = await openTooltip(button(container))
    // No sync time has been recorded, so the tooltip shows the
    // generic fetch title — not the "Last synced" line.
    expect(tooltip.textContent).toContain('action.fetch-title')
    expect(tooltip.textContent).not.toContain('repo-picker.tooltip.last-sync-label')
  })
})

function renderControl() {
  return renderInJsdom(
    <QueryClientProvider client={primaryWindowQueryClient}>
      <RepoActivityControl repoId={REPO_ID} />
    </QueryClientProvider>,
  )
}

function seedRepoForControl(input: Parameters<typeof seedRepoShellForTest>[0]) {
  const repo = seedRepoShellForTest(input)
  setRepoOperationsQueryData(repo.id, repo.repoRuntimeId, false, { operations: [], loadedAt: 0 })
  return repo
}

function serverOperation(
  repoRuntimeId: string,
  overrides: Pick<RepoServerOperationState, 'kind' | 'phase' | 'source'> & { branch?: string },
): RepoServerOperationState {
  return {
    id: `repo-op-${overrides.kind}-${overrides.phase}`,
    repoId: REPO_ID,
    repoRuntimeId,
    kind: overrides.kind,
    phase: overrides.phase,
    source: overrides.source,
    target: overrides.branch ? { branch: overrides.branch } : null,
    queuedAt: 100,
    startedAt: overrides.phase === 'queued' ? null : 101,
    deadlineAt: null,
    settledAt: null,
    error: null,
    cancellation: {
      underlyingRequested: false,
      reason: null,
      requestedAt: null,
      waitCancelledCount: 0,
      lastWaitCancelledAt: null,
      lastWaitCancellationReason: null,
    },
    canCancelUnderlying: true,
  }
}

function button(container: HTMLElement): HTMLButtonElement {
  const element = container.querySelector('button')
  if (!(element instanceof HTMLButtonElement)) throw new Error('Missing refresh button')
  return element
}

// Open the tooltip attached to `target` by dispatching a pointermove
// (Radix's hover trigger fires on this, not pointerover) and waiting
// past the Tip's 200ms open delay. Returns the rendered [role="tooltip"]
// node.
async function openTooltip(target: HTMLElement): Promise<HTMLElement> {
  // jsdom doesn't lay out the element, so getBoundingClientRect would
  // return all zeros; Radix only complains when the value is
  // explicitly invalid, so a stub is enough.
  target.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect

  await act(async () => {
    target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
  })
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 250))
  })
  const tooltip = document.body.querySelector('[role="tooltip"]')
  if (!(tooltip instanceof HTMLElement)) throw new Error('Tooltip did not open')
  return tooltip
}
