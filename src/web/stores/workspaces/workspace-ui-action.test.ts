import { describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { dispatchWorkspaceUiAction } from '#/web/stores/workspaces/workspace-ui-action.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/workspace-ui-action')
const WORKSPACE_RUNTIME_ID = 'workspace-runtime-ui-action'

describe('workspace UI action result boundary', () => {
  test('normalizes thrown errors and reports them with runtime authority', async () => {
    const reportResult = vi.fn()

    await expect(
      dispatchWorkspaceUiAction(
        WORKSPACE_ID,
        WORKSPACE_RUNTIME_ID,
        'editor',
        async () => {
          throw new Error('external app failed')
        },
        { reportResult },
      ),
    ).resolves.toEqual({ ok: false, message: 'external app failed' })
    expect(reportResult).toHaveBeenCalledWith(
      WORKSPACE_ID,
      { ok: false, message: 'external app failed' },
      WORKSPACE_RUNTIME_ID,
    )
  })

  test('ignores cancellation without reporting a failure', async () => {
    const reportResult = vi.fn()

    await expect(
      dispatchWorkspaceUiAction(
        WORKSPACE_ID,
        WORKSPACE_RUNTIME_ID,
        'terminal',
        async () => ({ ok: false, message: 'cancelled' }),
        { reportResult },
      ),
    ).resolves.toBeNull()
    expect(reportResult).not.toHaveBeenCalled()
  })

  test('keeps configured successful operations silent', async () => {
    const reportResult = vi.fn()

    await expect(
      dispatchWorkspaceUiAction(WORKSPACE_ID, WORKSPACE_RUNTIME_ID, 'finder', async () => ({ ok: true, message: '' }), {
        silentSuccessOps: new Set(['finder']),
        reportResult,
      }),
    ).resolves.toEqual({ ok: true, message: '' })
    expect(reportResult).not.toHaveBeenCalled()
  })

  test('does not report a result consumed by a dedicated handler', async () => {
    const reportResult = vi.fn()
    const handleResult = vi.fn(() => true)

    await expect(
      dispatchWorkspaceUiAction(
        WORKSPACE_ID,
        WORKSPACE_RUNTIME_ID,
        'editor',
        async () => ({ ok: false, message: 'handled failure' }),
        { handleResult, reportResult },
      ),
    ).resolves.toEqual({ ok: false, message: 'handled failure' })
    expect(handleResult).toHaveBeenCalledWith({ ok: false, message: 'handled failure' })
    expect(reportResult).not.toHaveBeenCalled()
  })
})
