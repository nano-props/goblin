import { describe, expect, test, vi } from 'vitest'
import {
  createWorkspacePaneRuntimeTabActionContext,
  readWorkspacePaneRuntimeTabActionContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-action-context.ts'

describe('workspace pane runtime tab action context', () => {
  test('creates runtime action context from explicit terminal capabilities', () => {
    const showRuntimeTab = vi.fn(() => true)
    const scrollToBottom = vi.fn()

    const context = createWorkspacePaneRuntimeTabActionContext({
      showRuntimeTab,
      terminal: {
        scrollToBottom,
      },
    })

    context.showRuntimeTab('terminal', 'session-1')
    context.terminal?.scrollToBottom?.('session-1')

    expect(showRuntimeTab).toHaveBeenCalledWith('terminal', 'session-1')
    expect(scrollToBottom).toHaveBeenCalledWith('session-1')
  })

  test('reads runtime action context from explicit route navigation capabilities', () => {
    const showRuntimeTab = vi.fn(() => true)

    const context = readWorkspacePaneRuntimeTabActionContext({ showRuntimeTab })

    context.showRuntimeTab('terminal', 'session-1')

    expect(showRuntimeTab).toHaveBeenCalledWith('terminal', 'session-1')
  })

  test('omits terminal runtime actions unless explicitly provided', () => {
    const context = readWorkspacePaneRuntimeTabActionContext({ showRuntimeTab: vi.fn() })

    expect(context.terminal).toBeUndefined()
  })
})
