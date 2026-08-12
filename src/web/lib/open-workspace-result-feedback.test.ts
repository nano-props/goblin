import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  reportCloseWorkspaceFailure,
  reportOpenWorkspacePostOpenEffects,
  reportOpenWorkspaceUncertainty,
} from '#/web/lib/open-workspace-result-feedback.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const feedbackMocks = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }))

vi.mock('vue-sonner', () => ({ toast: feedbackMocks }))

afterEach(() => {
  vi.clearAllMocks()
})

describe('open workspace result feedback', () => {
  test('presents uncertain open and close outcomes as warnings', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace')

    expect(
      reportOpenWorkspaceUncertainty(
        { ok: false, kind: 'uncertain', workspaceId, message: 'error.operation-outcome-uncertain' },
        (key) => key,
      ),
    ).toBe(true)
    expect(
      reportCloseWorkspaceFailure(
        { ok: false, kind: 'uncertain', message: 'error.operation-outcome-uncertain' },
        (key) => key,
      ),
    ).toBe(true)

    expect(feedbackMocks.warning).toHaveBeenCalledTimes(2)
    expect(feedbackMocks.error).not.toHaveBeenCalled()
  })

  test('presents conclusive close rejection as an error', () => {
    expect(
      reportCloseWorkspaceFailure(
        { ok: false, kind: 'failed', message: 'error.workspace-close-failed' },
        (key) => key,
      ),
    ).toBe(true)
    expect(feedbackMocks.error).toHaveBeenCalledWith('error.workspace-close-failed')
  })

  test('surfaces an uncertain accepted open without reporting it as rejected', async () => {
    reportOpenWorkspacePostOpenEffects(
      {
        ok: true,
        workspaceId: workspaceIdForTest('goblin+file:///workspace'),
        postOpenEffects: Promise.resolve([
          { kind: 'operation-outcome-uncertain', message: 'error.operation-outcome-uncertain' },
        ]),
      },
      (key) => key,
    )

    await vi.waitFor(() => {
      expect(feedbackMocks.warning).toHaveBeenCalledWith('error.operation-outcome-uncertain', {
        id: 'workspace-open-outcome-uncertain',
      })
    })
    expect(feedbackMocks.error).not.toHaveBeenCalled()
  })
})
