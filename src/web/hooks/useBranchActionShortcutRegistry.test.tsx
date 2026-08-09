// @vitest-environment jsdom

import { flushTestUpdates } from '#/test-utils/render.tsx'
import { defineComponent } from 'vue'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import type { BranchActionSurface } from '#/web/hooks/useBranchActionItems.tsx'
import { useBranchActionShortcutRegistry } from '#/web/hooks/useBranchActionShortcutRegistry.ts'
import { runBranchActionShortcut } from '#/web/keyboard/branch-action-shortcuts.ts'

describe('useBranchActionShortcutRegistry', () => {
  test('runs the visible branch action handler', async () => {
    const onPull = vi.fn()

    renderHookHost({
      mainItems: [
        {
          id: 'pull',
          label: 'Pull',
          disabled: false,
          visible: true,
          icon: null,
          onSelect: onPull,
        },
      ],
      destructiveItems: [],
    })

    await flushTestUpdates(() => {
      runBranchActionShortcut('pull')
    })

    expect(onPull).toHaveBeenCalledTimes(1)
  })

  test('does not run hidden or disabled actions', async () => {
    const hiddenPull = vi.fn()
    const disabledPush = vi.fn()

    renderHookHost({
      mainItems: [
        {
          id: 'pull',
          label: 'Pull',
          disabled: false,
          visible: false,
          icon: null,
          onSelect: hiddenPull,
        },
        {
          id: 'push',
          label: 'Push',
          disabled: true,
          visible: true,
          icon: null,
          onSelect: disabledPush,
        },
      ],
      destructiveItems: [],
    })

    await flushTestUpdates(() => {
      runBranchActionShortcut('pull')
      runBranchActionShortcut('push')
    })

    expect(hiddenPull).not.toHaveBeenCalled()
    expect(disabledPush).not.toHaveBeenCalled()
  })

  test('uses the latest action callbacks after rerender', async () => {
    const firstPull = vi.fn()
    const secondPull = vi.fn()

    const { rerender } = renderInJsdom(<HookHost actions={actionsWith(firstPull)} />)

    await flushTestUpdates(() => {
      runBranchActionShortcut('pull')
    })

    await rerender(<HookHost actions={actionsWith(secondPull)} />)

    await flushTestUpdates(() => {
      runBranchActionShortcut('pull')
    })

    expect(firstPull).toHaveBeenCalledTimes(1)
    expect(secondPull).toHaveBeenCalledTimes(1)
  })

  test('clears the shortcut handler while disabled', async () => {
    const onPull = vi.fn()

    const { rerender } = renderInJsdom(<HookHost actions={actionsWith(onPull)} />)

    await flushTestUpdates(() => {
      runBranchActionShortcut('pull')
    })
    expect(onPull).toHaveBeenCalledTimes(1)

    await rerender(<HookHost actions={actionsWith(onPull)} enabled={false} />)

    await flushTestUpdates(() => {
      runBranchActionShortcut('pull')
    })

    expect(onPull).toHaveBeenCalledTimes(1)
  })
})

type ShortcutActionItems = Pick<BranchActionSurface, 'mainItems' | 'destructiveItems'>

function renderHookHost(actions: ShortcutActionItems) {
  renderInJsdom(<HookHost actions={actions} />)
}

const HookHost = defineComponent<{ actions: ShortcutActionItems; enabled?: boolean }>({
  name: 'BranchActionShortcutRegistryTestHost',
  props: ['actions', 'enabled'],
  setup(props) {
    useBranchActionShortcutRegistry(
      () => props.actions,
      () => props.enabled !== false,
    )
    return () => null
  },
})

function actionsWith(onPull: () => void): ShortcutActionItems {
  return {
    mainItems: [
      {
        id: 'pull',
        label: 'Pull',
        disabled: false,
        visible: true,
        icon: null,
        onSelect: onPull,
      },
    ],
    destructiveItems: [],
  }
}
