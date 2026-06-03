// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useKeyboard } from '#/web/hooks/useKeyboard.ts'
import { resetReposStore } from '#/web/stores/repos/test-utils.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
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

describe('useKeyboard', () => {
  test('esc exits the settings route', async () => {
    const onExitSettings = vi.fn()
    await renderHookHost({
      isWorkspaceShortcutSuppressed: () => true,
      isSettingsOpen: () => true,
      onExitSettings,
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await Promise.resolve()
    })

    expect(onExitSettings).toHaveBeenCalledTimes(1)
  })
})

async function renderHookHost(
  overrides: Partial<{
    currentRepoId: string | null
    isWorkspaceShortcutSuppressed: () => boolean
    isSettingsOpen: () => boolean
    onExitSettings: () => void
  }> = {},
) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<HookHost {...overrides} />)
    await Promise.resolve()
  })
}

function HookHost(
  overrides: Partial<{
    currentRepoId: string | null
    isWorkspaceShortcutSuppressed: () => boolean
    isSettingsOpen: () => boolean
    onExitSettings: () => void
  }>,
) {
  useKeyboard({
    navigation: navigationWith(),
    currentRepoId: overrides.currentRepoId ?? null,
    onShowHelp: () => {},
    isWorkspaceShortcutSuppressed: overrides.isWorkspaceShortcutSuppressed ?? (() => false),
    isSettingsOpen: overrides.isSettingsOpen ?? (() => false),
    onExitSettings: overrides.onExitSettings ?? (() => {}),
  })
  return null
}

function navigationWith(): MainWindowNavigationActions {
  return {
    activateRepo: () => {},
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoDetailTab: () => {},
    showRepoBranchDetailTab: () => {},
    openSettings: () => {},
  }
}
