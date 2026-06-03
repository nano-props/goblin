// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAppBootstrap } from '#/web/hooks/useAppBootstrap.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useSettingsStore } from '#/web/stores/settings.ts'
import { resetReposStore } from '#/web/stores/repos/test-utils.ts'
import { useThemeStore } from '#/web/stores/theme.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  vi.restoreAllMocks()
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

describe('useAppBootstrap', () => {
  test('canonicalizes boot session layout before applying it to the repos store', async () => {
    vi.spyOn(useThemeStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useSettingsStore.getState(), 'hydrateExternalApps').mockResolvedValue(undefined)
    vi.spyOn(useSettingsStore.getState(), 'hydrate').mockResolvedValue({
      openRepos: [{ kind: 'local', id: '/tmp/repo' }],
      activeRepo: '/tmp/repo',
      detailCollapsed: true,
      detailFocusMode: true,
      workspaceLayout: 'left-right',
      detailPaneSizes: { 'top-bottom': 55, 'left-right': 45 },
      selectedTerminalByWorktree: { '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-2' },
    })
    vi.spyOn(useSettingsStore.getState(), 'consumeBootSessionSnapshot').mockReturnValue({
      openRepos: [{ kind: 'local', id: '/tmp/repo' }],
      activeRepo: '/tmp/repo',
      detailCollapsed: true,
      detailFocusMode: true,
      workspaceLayout: 'left-right',
      detailPaneSizes: { 'top-bottom': 55, 'left-right': 45 },
      selectedTerminalByWorktree: { '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-2' },
    })
    const hydrateSession = vi.spyOn(useReposStore.getState(), 'hydrateSession').mockResolvedValue(undefined)

    await render(<Harness />)

    const state = useReposStore.getState()
    expect(state.workspaceLayout).toBe('left-right')
    expect(state.detailCollapsed).toBe(false)
    expect(state.detailFocusMode).toBe(false)
    expect(state.detailPaneSizes).toEqual({ 'top-bottom': 55, 'left-right': 45 })
    expect(state.selectedTerminalByWorktree).toEqual({ '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-2' })
    expect(hydrateSession).toHaveBeenCalledWith([{ kind: 'local', id: '/tmp/repo' }], '/tmp/repo')
  })
})

function Harness() {
  useAppBootstrap()
  return null
}

async function render(element: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(element)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}
