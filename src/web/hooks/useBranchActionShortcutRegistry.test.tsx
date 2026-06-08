// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { BranchActionItemGroups } from '#/web/hooks/useBranchActionItems.ts'
import { useBranchActionShortcutRegistry } from '#/web/hooks/useBranchActionShortcutRegistry.ts'
import { runBranchActionShortcut } from '#/web/keyboard/branch-action-shortcuts.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('useBranchActionShortcutRegistry', () => {
  test('runs the visible branch action handler', async () => {
    const onPull = vi.fn()

    await renderHookHost({
      patchItems: [],
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
      dialogs: null,
    })

    act(() => {
      runBranchActionShortcut('pull')
    })

    expect(onPull).toHaveBeenCalledTimes(1)
  })

  test('does not run hidden or disabled actions', async () => {
    const hiddenPull = vi.fn()
    const disabledPush = vi.fn()

    await renderHookHost({
      patchItems: [],
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
      dialogs: null,
    })

    act(() => {
      runBranchActionShortcut('pull')
      runBranchActionShortcut('push')
    })

    expect(hiddenPull).not.toHaveBeenCalled()
    expect(disabledPush).not.toHaveBeenCalled()
  })

  test('uses the latest action callbacks after rerender', async () => {
    const firstPull = vi.fn()
    const secondPull = vi.fn()

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root!.render(<HookHost actions={actionsWith(firstPull)} />)
      await Promise.resolve()
    })

    act(() => {
      runBranchActionShortcut('pull')
    })

    await act(async () => {
      root!.render(<HookHost actions={actionsWith(secondPull)} />)
      await Promise.resolve()
    })

    act(() => {
      runBranchActionShortcut('pull')
    })

    expect(firstPull).toHaveBeenCalledTimes(1)
    expect(secondPull).toHaveBeenCalledTimes(1)
  })
})

async function renderHookHost(actions: BranchActionItemGroups) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<HookHost actions={actions} />)
    await Promise.resolve()
  })
}

function HookHost({ actions }: { actions: BranchActionItemGroups }) {
  useBranchActionShortcutRegistry(actions)
  return null
}

function actionsWith(onPull: () => void): BranchActionItemGroups {
  return {
    patchItems: [],
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
    dialogs: null,
  }
}
