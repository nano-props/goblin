// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { RepoActivityControl } from '#/web/components/repo-activity/RepoActivityControl.tsx'
import { resetReposStore, seedRepoShellForTest } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { markRepoOperationTargets, nextRepoOperationId } from '#/web/stores/repos/repo-operation-scheduler.ts'

const REPO_ID = '/tmp/repo-activity-control-component'

beforeEach(() => {
  vi.useFakeTimers()
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

afterEach(() => {
  vi.useRealTimers()
})

describe('RepoActivityControl component', () => {
  test('keeps the primary refresh button enabled during background-blocked refresh states', () => {
    seedRepoShellForTest({ id: REPO_ID, remote: { hasRemotes: true } })
    markRepoOperationTargets(REPO_ID, nextRepoOperationId(REPO_ID), [{ key: 'visibleStatus', reason: 'visible-status' }], 'running')

    const { container } = renderInJsdom(<RepoActivityControl repoId={REPO_ID} />)

    expect(button(container).disabled).toBe(false)
    expect(button(container).getAttribute('aria-busy')).toBeNull()
  })

  test('disables the primary refresh button during manual refreshes', () => {
    seedRepoShellForTest({ id: REPO_ID, remote: { hasRemotes: true } })
    markRepoOperationTargets(
      REPO_ID,
      nextRepoOperationId(REPO_ID),
      [{ key: 'manualRefresh', reason: 'manual-refresh' }],
      'running',
    )

    const { container } = renderInJsdom(<RepoActivityControl repoId={REPO_ID} />)

    expect(button(container).disabled).toBe(true)
    expect(button(container).getAttribute('aria-busy')).toBe('true')
  })

  test('renders the primary refresh button for local-only repositories without the local-only label', () => {
    seedRepoShellForTest({ id: REPO_ID, remote: { hasRemotes: false } })

    const { container } = renderInJsdom(<RepoActivityControl repoId={REPO_ID} />)

    expect(button(container).disabled).toBe(false)
    expect(container.textContent).not.toContain('tab.local-only')
  })

  test('shows the last-sync time in the refresh button tooltip when fetch has loaded', async () => {
    const loadedAt = Date.now() - 5_000
    const repo = seedRepoShellForTest({ id: REPO_ID, remote: { hasRemotes: true } })
    useReposStore.setState((state) => ({
      repos: {
        ...state.repos,
        [REPO_ID]: {
          ...repo,
          // Use the fetch data load since `latestRepoSyncTime` reads
          // `dataLoads.fetch.loadedAt` directly; setting snapshot
          // requires `projection.source === 'fresh'` which would also
          // work but couples this test to a second code path.
          dataLoads: {
            ...repo.dataLoads,
            fetch: { ...repo.dataLoads.fetch, loadedAt },
          },
        },
      },
    }))

    const { container } = renderInJsdom(<RepoActivityControl repoId={REPO_ID} />)

    const tooltip = await openTooltip(button(container))
    // The tooltip should be a single line (no separator), starting
    // with the "Last synced" label, and the relative time should be
    // present (date-fns renders "5 seconds ago" in en).
    expect(tooltip.textContent).toContain('repo-picker.tooltip.last-sync-label')
    expect(tooltip.textContent).toMatch(/5\s+seconds?/)
  })

  test('falls back to the fetch action title in the refresh button tooltip before the first sync', async () => {
    seedRepoShellForTest({ id: REPO_ID, remote: { hasRemotes: true } })

    const { container } = renderInJsdom(<RepoActivityControl repoId={REPO_ID} />)

    const tooltip = await openTooltip(button(container))
    // No sync time has been recorded, so the tooltip shows the
    // generic fetch title — not the "Last synced" line.
    expect(tooltip.textContent).toContain('action.fetch-title')
    expect(tooltip.textContent).not.toContain('repo-picker.tooltip.last-sync-label')
  })
})

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
    vi.runAllTimers()
    await Promise.resolve()
  })
  const tooltip = document.body.querySelector('[role="tooltip"]')
  if (!(tooltip instanceof HTMLElement)) throw new Error('Tooltip did not open')
  return tooltip
}
