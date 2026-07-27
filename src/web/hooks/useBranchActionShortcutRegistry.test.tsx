// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import type { BranchActionSurface } from '#/web/hooks/useBranchActionItems.ts'
import { useBranchActionShortcutRegistry } from '#/web/hooks/useBranchActionShortcutRegistry.ts'
import { runBranchActionShortcut } from '#/web/keyboard/branch-action-shortcuts.ts'

describe('useBranchActionShortcutRegistry', () => {
  test('runs the visible branch action handler', () => {
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

    act(() => {
      runBranchActionShortcut('pull')
    })

    expect(onPull).toHaveBeenCalledTimes(1)
  })

  test('does not run hidden or disabled actions', () => {
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

    act(() => {
      runBranchActionShortcut('pull')
      runBranchActionShortcut('push')
    })

    expect(hiddenPull).not.toHaveBeenCalled()
    expect(disabledPush).not.toHaveBeenCalled()
  })

  test('uses the latest action callbacks after rerender', () => {
    const firstPull = vi.fn()
    const secondPull = vi.fn()

    const { rerender } = renderInJsdom(<HookHost actions={actionsWith(firstPull)} />)

    act(() => {
      runBranchActionShortcut('pull')
    })

    rerender(<HookHost actions={actionsWith(secondPull)} />)

    act(() => {
      runBranchActionShortcut('pull')
    })

    expect(firstPull).toHaveBeenCalledTimes(1)
    expect(secondPull).toHaveBeenCalledTimes(1)
  })

  test('clears the shortcut handler while disabled', () => {
    const onPull = vi.fn()

    const { rerender } = renderInJsdom(<HookHost actions={actionsWith(onPull)} />)

    act(() => {
      runBranchActionShortcut('pull')
    })
    expect(onPull).toHaveBeenCalledTimes(1)

    rerender(<HookHost actions={actionsWith(onPull)} enabled={false} />)

    act(() => {
      runBranchActionShortcut('pull')
    })

    expect(onPull).toHaveBeenCalledTimes(1)
  })
})

type ShortcutActionItems = Pick<BranchActionSurface, 'mainItems' | 'destructiveItems'>

function renderHookHost(actions: ShortcutActionItems) {
  renderInJsdom(<HookHost actions={actions} />)
}

function HookHost({ actions, enabled = true }: { actions: ShortcutActionItems; enabled?: boolean }) {
  useBranchActionShortcutRegistry(actions, enabled)
  return null
}

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
