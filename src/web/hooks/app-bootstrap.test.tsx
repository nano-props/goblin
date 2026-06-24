// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { useAuthenticatedAppBootstrap } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import { usePublicAppBootstrap } from '#/web/hooks/usePublicAppBootstrap.ts'
import { getSettingsSnapshot } from '#/web/settings-client.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useSessionRestoreStore } from '#/web/stores/session-restore.ts'
import { resetReposStore } from '#/web/stores/repos/test-utils.ts'
import { useThemeStore } from '#/web/stores/theme.ts'

vi.mock('#/web/settings-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/web/settings-client.ts')>()
  return {
    ...actual,
    getSettingsSnapshot: vi.fn(),
  }
})

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const mockedGetSettingsSnapshot = vi.mocked(getSettingsSnapshot)

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  vi.restoreAllMocks()
  mockedGetSettingsSnapshot.mockReset()
  mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
  useSessionRestoreStore.setState({ bootSessionSnapshot: null })
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

describe('app bootstrap hooks', () => {
  test('public bootstrap hydrates only unauthenticated-safe stores', async () => {
    const hydrateTheme = vi.spyOn(useThemeStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateSessionRestore = vi.spyOn(useSessionRestoreStore.getState(), 'hydrate').mockResolvedValue({
      openRepos: [{ kind: 'local', id: '/tmp/repo' }],
      activeRepo: '/tmp/repo',
      workspaceFocused: true,
      workspacePaneSize: 50,
      selectedTerminalByWorktree: {},
      workspacePaneTabOrderByBranchByRepo: {},
    })
    const hydrateI18n = vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateHostInfo = vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)

    await render(<PublicHarness />)

    expect(hydrateI18n).not.toHaveBeenCalled()
    expect(hydrateHostInfo).toHaveBeenCalled()
    expect(hydrateTheme).not.toHaveBeenCalled()
    expect(hydrateSessionRestore).not.toHaveBeenCalled()
    expect(mockedGetSettingsSnapshot).not.toHaveBeenCalled()
  })

  test('canonicalizes boot session pane state before applying it to the repos store', async () => {
    const session = {
      openRepos: [{ kind: 'local' as const, id: '/tmp/repo' }],
      activeRepo: '/tmp/repo',
      workspaceFocused: false,
      workspacePaneSize: 45,
      selectedTerminalByWorktree: { '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0slot-2' },
      workspacePaneTabOrderByBranchByRepo: {
        '/tmp/repo': {
          main: [],
        },
      },
    }
    const settings = defaultSettingsSnapshot({ session })
    mockedGetSettingsSnapshot.mockResolvedValue(settings)
    const hydrateTheme = vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockResolvedValue(undefined)
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockResolvedValue(undefined)
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockResolvedValue(undefined)
    const hydrateSession = vi.spyOn(useReposStore.getState(), 'hydrateSession').mockResolvedValue(undefined)

    await render(<Harness />)

    const state = useReposStore.getState()
    expect(state.workspaceFocused).toBe(false)
    expect(state.workspacePaneSize).toBe(45)
    expect(state.selectedTerminalByWorktree).toEqual({
      '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0slot-2',
    })
    expect(hydrateSession).toHaveBeenCalledWith([{ kind: 'local', id: '/tmp/repo' }], '/tmp/repo', {
      workspacePaneRestoreState: {
        workspacePaneTabOrderByBranchByRepo: {
          '/tmp/repo': {
            main: [],
          },
        },
        preferredWorkspacePaneViewByBranchByRepo: {},
      },
    })
    expect(hydrateTheme).toHaveBeenCalledWith(settings)
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(1)
  })

  test('restores the boot session when non-critical authenticated hydrates fail', async () => {
    const session = {
      openRepos: [{ kind: 'local' as const, id: '/tmp/repo' }],
      activeRepo: '/tmp/repo',
      workspaceFocused: true,
      workspacePaneSize: 55,
      selectedTerminalByWorktree: {},
      workspacePaneTabOrderByBranchByRepo: {},
    }
    mockedGetSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot({ session }))
    vi.spyOn(useThemeStore.getState(), 'hydrateFromSettingsSnapshot').mockRejectedValue(new Error('theme unavailable'))
    vi.spyOn(useI18nStore.getState(), 'hydrate').mockRejectedValue(new Error('i18n unavailable'))
    vi.spyOn(useHostInfoStore.getState(), 'hydrate').mockRejectedValue(new Error('host unavailable'))
    const hydrateSession = vi.spyOn(useReposStore.getState(), 'hydrateSession').mockResolvedValue(undefined)

    await render(<Harness />)

    expect(hydrateSession).toHaveBeenCalledWith([{ kind: 'local', id: '/tmp/repo' }], '/tmp/repo', {
      workspacePaneRestoreState: {
        workspacePaneTabOrderByBranchByRepo: {},
        preferredWorkspacePaneViewByBranchByRepo: {},
      },
    })
    expect(useReposStore.getState().workspacePaneSize).toBe(55)
    expect(mockedGetSettingsSnapshot).toHaveBeenCalledTimes(1)
  })
})

function Harness() {
  useAuthenticatedAppBootstrap()
  return null
}

function PublicHarness() {
  usePublicAppBootstrap()
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
