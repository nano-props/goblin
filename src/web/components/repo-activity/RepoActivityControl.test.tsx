// @vitest-environment jsdom

import { seedRepoWithReadModelForTest, resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { fireEvent, waitFor } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { advanceTimersAndFlush, useFakeTimers } from '#/test-utils/timers.ts'
import { RepoActivityControl } from '#/web/components/repo-activity/RepoActivityControl.tsx'
import { i18nStore } from '#/web/stores/i18n.ts'
import {
  markRepoOperationTargets,
  nextRepoOperationId,
  settleRepoOperationTargets,
} from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { setRepoOperationsQueryData } from '#/web/repo-query-cache.ts'
import { repoOperationsQueryKey } from '#/web/repo-query-keys.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import type { RepoServerOperationState } from '#/shared/api-types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const refreshMocks = vi.hoisted(() => ({
  run: vi.fn<() => Promise<{ ok: true } | { ok: false; message: string }>>(async () => ({ ok: true })),
}))
const toastMocks = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('#/web/stores/workspaces/workspace-refresh-command.ts', () => ({
  runWorkspaceRefresh: refreshMocks.run,
}))
vi.mock('vue-sonner', () => ({ toast: toastMocks }))

const REPO_ID = workspaceIdForTest('goblin+file:///workspace/repo-activity-control-component')

beforeEach(() => {
  refreshMocks.run.mockReset()
  refreshMocks.run.mockResolvedValue({ ok: true })
  toastMocks.error.mockClear()
  resetWorkspacesStore()
  // Empty dict so `t('key')` returns the key itself — lets the test
  // assert the exact key the tooltip wires up, independent of the
  // dictionary snapshot (which is hydrated over IPC in production).
  i18nStore.setState({
    lang: 'en',
    pref: 'auto',
    dict: {},
    hydrate: async () => {},
    setPref: async () => {},
  })
})

describe('RepoActivityControl', () => {
  test('disables the primary refresh button while server projection reports a user fetch', () => {
    const repo = seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: true } })
    setRepoOperationsQueryData(REPO_ID, repo.workspaceRuntimeId, false, {
      operations: [serverOperation(repo.workspaceRuntimeId, { kind: 'fetch', phase: 'running', source: 'user' })],
      lastFetchAt: null,
      loadedAt: 123,
    })

    const { container } = renderControl()

    expect(button(container).disabled).toBe(true)
    expect(button(container).getAttribute('aria-busy')).toBe('true')
  })

  test('keeps the primary refresh button idle while server projection reports a background fetch', () => {
    const repo = seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: true } })
    setRepoOperationsQueryData(REPO_ID, repo.workspaceRuntimeId, false, {
      operations: [serverOperation(repo.workspaceRuntimeId, { kind: 'fetch', phase: 'running', source: 'background' })],
      lastFetchAt: null,
      loadedAt: 123,
    })

    const { container } = renderControl()

    expect(button(container).disabled).toBe(false)
    expect(button(container).getAttribute('aria-busy')).toBeNull()
  })

  test('renders branch action activity from server operation projection', async () => {
    useFakeTimers()
    const repo = seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: true } })
    setRepoOperationsQueryData(REPO_ID, repo.workspaceRuntimeId, false, {
      operations: [
        serverOperation(repo.workspaceRuntimeId, {
          kind: 'push',
          phase: 'queued',
          source: 'user',
          branch: 'feature/a',
        }),
      ],
      lastFetchAt: null,
      loadedAt: 123,
    })

    const { container } = renderControl()

    await flushTestUpdates(() => advanceTimersAndFlush(120))

    expect(container.textContent).toContain('action.push-queued')
    expect(button(container).getAttribute('aria-busy')).toBe('true')
  })

  test('shows pending feedback immediately while a clicked refresh is running', async () => {
    const refresh = Promise.withResolvers<{ ok: true }>()
    refreshMocks.run.mockReturnValueOnce(refresh.promise)
    seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: true } })
    const { container } = renderControl()

    await fireEvent.click(button(container))

    expect(button(container).disabled).toBe(true)
    expect(button(container).getAttribute('aria-busy')).toBe('true')
    expect(button(container).querySelector('svg')?.classList.contains('animate-spin')).toBe(true)

    await fireEvent.click(button(container))
    expect(refreshMocks.run).toHaveBeenCalledOnce()

    refresh.resolve({ ok: true })

    await waitFor(() => {
      expect(button(container).disabled).toBe(false)
      expect(button(container).getAttribute('aria-busy')).toBeNull()
      expect(button(container).querySelector('svg')?.classList.contains('animate-spin')).toBe(false)
    })
  })

  test('stops clicked refresh feedback when the command settles after an intervening parent render', async () => {
    const refresh = Promise.withResolvers<{ ok: true }>()
    refreshMocks.run.mockReturnValueOnce(refresh.promise)
    seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: true } })
    const rendered = renderControl()

    await fireEvent.click(button(rendered.container))

    const operationId = nextRepoOperationId(REPO_ID)
    markRepoOperationTargets(
      REPO_ID,
      operationId,
      [{ key: 'workspaceRefresh', reason: 'workspace-refresh' }],
      'running',
    )
    await rendered.rerender(control())
    settleRepoOperationTargets(REPO_ID, operationId, [{ key: 'workspaceRefresh', reason: 'workspace-refresh' }], null)

    await flushTestUpdates(async () => {
      refresh.resolve({ ok: true })
      await refresh.promise
    })

    await waitFor(() => {
      expect(button(rendered.container).disabled).toBe(false)
      expect(button(rendered.container).getAttribute('aria-busy')).toBeNull()
      expect(button(rendered.container).querySelector('svg')?.classList.contains('animate-spin')).toBe(false)
    })
  })

  test('renders the primary refresh button for local-only repositories without the local-only label', () => {
    seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: false } })

    const { container } = renderControl()

    expect(button(container).disabled).toBe(false)
    expect(container.textContent).not.toContain('tab.local-only')
  })

  test('presents capability refresh failures from the Git refresh button', async () => {
    seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: false } })
    refreshMocks.run.mockResolvedValueOnce({ ok: false, message: 'error.workspace-operation-failed' })
    const { container } = renderControl()

    await fireEvent.click(button(container))

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledWith('error.workspace-operation-failed'))
  })

  test('shows the last-sync time in the refresh button tooltip when fetch has loaded', async () => {
    useFakeTimers()
    const loadedAt = Date.now() - 5_000
    const repo = seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: true } })
    setRepoOperationsQueryData(repo.id, repo.workspaceRuntimeId, false, {
      operations: [],
      lastFetchAt: loadedAt,
      loadedAt,
    })

    const { container } = renderControl()

    const tooltip = await openTooltip(button(container))
    // The tooltip should be a single line (no separator), starting
    // with the "Last synced" label, and the relative time should be
    // present (date-fns renders "5 seconds ago" in en).
    expect(tooltip.textContent).toContain('workspace-picker.tooltip.last-sync-label')
    expect(tooltip.textContent).toMatch(/5\s+seconds?/)
  })

  test('shows an unknown sync time before the first successful sync', async () => {
    useFakeTimers()
    seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: true } })

    const { container } = renderControl()

    const tooltip = await openTooltip(button(container))
    // No sync time has been recorded, so the tooltip shows the
    // generic fetch title — not the "Last synced" line.
    expect(tooltip.textContent).toContain('workspace-picker.tooltip.last-sync-label')
    expect(tooltip.textContent).toContain('workspace-picker.tooltip.last-sync-unknown')
  })

  test('does not present cached sync state after canonical operations read fails', async () => {
    useFakeTimers()
    const loadedAt = Date.now() - 5_000
    const repo = seedRepoForControl({ id: REPO_ID, remote: { hasRemotes: true } })
    const queryKey = repoOperationsQueryKey(repo.id, repo.workspaceRuntimeId)
    setRepoOperationsQueryData(repo.id, repo.workspaceRuntimeId, false, {
      operations: [serverOperation(repo.workspaceRuntimeId, { kind: 'fetch', phase: 'running', source: 'user' })],
      lastFetchAt: loadedAt,
      loadedAt,
    })
    const query = appQueryClient.getQueryCache().find({ queryKey, exact: true })
    if (!query) throw new Error('Missing operations query')
    query.setState({ ...query.state, status: 'error', error: new Error('error.repository-boundary-unavailable') })

    const { container } = renderControl()

    expect(button(container).disabled).toBe(false)
    const tooltip = await openTooltip(button(container))
    expect(tooltip.textContent).toContain('workspace-picker.tooltip.last-sync-unknown')
    expect(tooltip.textContent).not.toMatch(/5\s+seconds?/)
  })
})

function renderControl() {
  return renderInJsdom(control())
}

function control() {
  return (
    <VueQueryClientScope client={appQueryClient}>
      <RepoActivityControl repoId={REPO_ID} />
    </VueQueryClientScope>
  )
}

function seedRepoForControl(input: Parameters<typeof seedRepoWithReadModelForTest>[0]) {
  const repo = seedRepoWithReadModelForTest(input)
  setRepoOperationsQueryData(repo.id, repo.workspaceRuntimeId, false, {
    operations: [],
    lastFetchAt: null,
    loadedAt: 0,
  })
  return repo
}

function serverOperation(
  workspaceRuntimeId: string,
  overrides: Pick<RepoServerOperationState, 'kind' | 'phase' | 'source'> & { branch?: string },
): RepoServerOperationState {
  return {
    id: `repo-op-${overrides.kind}-${overrides.phase}`,
    repoId: REPO_ID,
    workspaceRuntimeId,
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
// (Reka's hover trigger fires on this, not pointerover) and advancing
// through the Tip's 200ms open delay. Returns the rendered tooltip node.
async function openTooltip(target: HTMLElement): Promise<HTMLElement> {
  // jsdom doesn't lay out the element, so getBoundingClientRect would
  // return all zeros; Reka only complains when the value is
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

  await flushTestUpdates(async () => {
    target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
  })
  await flushTestUpdates(() => advanceTimersAndFlush(200))
  const tooltip = document.body.querySelector('[role="tooltip"]')
  if (!(tooltip instanceof HTMLElement)) throw new Error('Tooltip did not open')
  return tooltip
}
