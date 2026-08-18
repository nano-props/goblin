// @vitest-environment jsdom

import { createMemoryHistory, createRouter } from 'vue-router'
import { QueryClient } from '@tanstack/vue-query'
import { defineComponent, reactive, ref } from 'vue'
import { userEvent } from '@testing-library/user-event'
import { waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { Layout } from '#/web/Layout.tsx'
import { useWorkspaceTerminalBellCounts } from '#/web/terminal/components/terminal-session-store.ts'
import type { TerminalSessionContextValue, TerminalSessionReadContextValue } from '#/web/terminal/components/types.ts'
import type { AuthenticatedAppBootstrapState } from '#/web/app/bootstrap/authenticated.ts'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { provideBootstrapLoadingPresentation } from '#/web/app/bootstrap/bootstrap-loading-presentation.ts'
import { CenteredLoadingStatus } from '#/web/components/CenteredLoadingStatus.tsx'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///example-workspace')
const authenticatedBootstrapMock = vi.hoisted(() => ({
  retry: vi.fn(),
}))
const authMock = vi.hoisted(() => ({
  status: null as unknown as {
    state: 'checking' | 'authenticated' | 'unauthenticated' | 'unavailable'
    refresh: ReturnType<typeof vi.fn>
  },
}))
const workspaceOpenDialogMock = vi.hoisted(() => ({ renderError: null as Error | null }))
const authenticatedBootstrapState = ref<AuthenticatedAppBootstrapState>({ status: 'ready' })
const clientIntentIngress = vi.hoisted(() => ({
  listeners: new Set<(intent: { type: string }) => void>(),
  subscriptionStarts: 0,
}))
const clientWorkspacePersistence = vi.hoisted(() => vi.fn())
const layoutQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

vi.mock('#/web/auth/AuthProvider.tsx', () => ({
  useAuth: () => authMock.status,
}))

vi.mock('#/web/app/bootstrap/authenticated.ts', () => ({
  useAuthenticatedAppBootstrap: () => ({ state: authenticatedBootstrapState, retry: authenticatedBootstrapMock.retry }),
}))

vi.mock('#/web/bridge/ingress.ts', () => ({
  subscribeClientEffectIntent: (listener: (intent: { type: string }) => void) => {
    clientIntentIngress.subscriptionStarts += 1
    clientIntentIngress.listeners.add(listener)
    return () => clientIntentIngress.listeners.delete(listener)
  },
}))

vi.mock('#/web/hooks/useClientWorkspacePersistence.ts', () => ({
  useClientWorkspacePersistence: clientWorkspacePersistence,
}))

vi.mock('#/web/realtime/client-intent-ingress.ts', () => ({
  subscribeServerClientIntentIngress: () => () => {},
}))

vi.mock('#/web/components/WorkspaceOpenDialog.tsx', async () => {
  const { defineComponent } = await import('vue')
  return {
    WorkspaceOpenDialog: defineComponent<{ open: boolean }>({
      name: 'WorkspaceOpenDialogMock',
      props: ['open'],
      setup(props) {
        return () => {
          if (workspaceOpenDialogMock.renderError) throw workspaceOpenDialogMock.renderError
          return props.open ? <span data-testid="workspace-open-dialog" /> : null
        }
      },
    }),
  }
})

vi.mock('#/web/app/navigation/history-presentation.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  useAppHistoryPresentationObserver: () => undefined,
}))

vi.mock('#/web/terminal/components/TerminalSessionProvider.tsx', async () => {
  const { defineComponent } = await import('vue')
  const { TerminalSessionCommandScope, TerminalSessionReadScope } =
    await import('#/web/terminal/components/terminal-session-context.ts')
  const readContext: TerminalSessionReadContextValue = {
    terminalFilesystemTargetSnapshot: () => ({
      terminalFilesystemTargetKey: '',
      selectedDescriptor: null,
      sessions: [],
      count: 0,
      bellCount: 0,
      outputActiveCount: 0,
      createPending: false,
    }),
    subscribeTerminalFilesystemTarget: () => () => {},
    workspaceBellCount: () => 4,
    subscribeWorkspaceBellCount: () => () => {},
    workspaceTerminalSessions: () => [],
    subscribeWorkspaceTerminalSessions: () => () => {},
    snapshot: () => ({
      phase: 'opening',
      message: null,
      processName: 'terminal',
      composer: { expanded: false, mode: 'keys', draft: '', historyEntries: [] },
    }),
    subscribeSnapshot: () => () => {},
  }
  const commandContext: TerminalSessionContextValue = {
    createTerminal: vi.fn(async () => ''),
    createTerminalWithAdmission: vi.fn(async () => ({
      terminalSessionId: '',
      presentation: { kind: 'git-worktree' as const },
      resourceDisposition: 'created',
      runtimeProjectionApplied: false,
      requestRole: 'leader',
    })) as TerminalSessionContextValue['createTerminalWithAdmission'],
    selectTerminal: vi.fn(),
    scrollToBottom: vi.fn(),
    readCopyText: vi.fn(() => null),
    openComposer: vi.fn(() => true),
    closeComposer: vi.fn(() => true),
    setComposerMode: vi.fn(() => true),
    setComposerDraft: vi.fn(() => true),
    replaceComposerDraft: vi.fn(() => true),
    clearBell: vi.fn(() => false),
    closeTerminalByDescriptor: vi.fn(async () => ({ kind: 'not-committed' as const, message: null })),
    attach: vi.fn(),
    detach: vi.fn(),
    restart: vi.fn(),
    focusTerminal: vi.fn(),
    findNext: vi.fn(() => ({ resultIndex: 0, resultCount: 0, found: false })),
    findPrevious: vi.fn(() => ({ resultIndex: 0, resultCount: 0, found: false })),
    clearSearch: vi.fn(),
    captureInputWriter: vi.fn(() => null),
    sendVirtualKey: vi.fn(),
    submitText: vi.fn(async () => false),
    takeover: vi.fn(async () => false),
    retryPresentation: vi.fn(() => false),
  }
  return {
    TerminalSessionProvider: defineComponent({
      name: 'TerminalSessionProviderMock',
      setup(_props, { slots }) {
        return () => (
          <TerminalSessionCommandScope value={commandContext}>
            <TerminalSessionReadScope value={readContext}>{slots.default?.()}</TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        )
      },
    }),
  }
})

const SettingsRetainedOutletTerminalConsumer = defineComponent({
  name: 'SettingsRetainedOutletTerminalConsumer',
  setup() {
    const bellCounts = useWorkspaceTerminalBellCounts([WORKSPACE_ID])
    return () => <span data-testid="settings-retained-terminal-consumer">{bellCounts.value[WORKSPACE_ID]}</span>
  },
})

beforeEach(() => {
  authMock.status = reactive({
    state: 'authenticated' as 'checking' | 'authenticated' | 'unauthenticated' | 'unavailable',
    refresh: vi.fn(),
  })
  workspaceOpenDialogMock.renderError = null
  authenticatedBootstrapState.value = { status: 'ready' }
  authenticatedBootstrapMock.retry.mockReset()
  clientIntentIngress.listeners.clear()
  clientIntentIngress.subscriptionStarts = 0
  clientWorkspacePersistence.mockClear()
  layoutQueryClient.clear()
})

describe('Layout shell providers', () => {
  test('owns the intent router on settings and keeps the single preload consumer across route changes', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/settings/general', name: 'settings', component: { template: '<div>settings</div>' } },
        { path: '/', name: 'home', component: { template: '<div>workspace</div>' } },
      ],
    })
    await router.push('/settings/general')
    await router.isReady()
    renderLayout(router)

    expect(clientIntentIngress.subscriptionStarts).toBe(1)
    expect(clientWorkspacePersistence).toHaveBeenCalledOnce()
    await flushTestUpdates(() => {
      for (const listener of clientIntentIngress.listeners) listener({ type: 'open-workspace-path-requested' })
    })
    await waitFor(() => expect(document.querySelector('[data-testid="workspace-open-dialog"]')).not.toBeNull())

    await flushTestUpdates(async () => {
      await router.push('/')
    })

    expect(clientIntentIngress.subscriptionStarts).toBe(1)
    expect(clientWorkspacePersistence).toHaveBeenCalledOnce()
  })

  test('keeps terminal read context above the settings shell outlet while workspace restore is pending', async () => {
    authenticatedBootstrapState.value = { status: 'restoring-workspace' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/settings/general', name: 'settings', component: SettingsRetainedOutletTerminalConsumer }],
    })
    await router.push('/settings/general')
    await router.isReady()
    const { getByTestId } = renderLayout(router)

    expect(getByTestId('settings-retained-terminal-consumer').textContent).toBe('4')
  })

  test('keeps bootstrap loading visible before mounting the workspace shell', async () => {
    authenticatedBootstrapState.value = { status: 'restoring-workspace' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'home', component: { template: '<div>workspace</div>' } }],
    })
    await router.push('/')
    await router.isReady()
    const { queryByText } = renderLayout(router)

    expect(document.querySelector('[data-testid="bootstrap-loading-visible"]')?.textContent).toBe('true')
    expect(queryByText('workspace')).toBeNull()
  })

  test('delegates workspace restore progress to the root loading presentation', async () => {
    authenticatedBootstrapState.value = { status: 'restoring-workspace' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'home', component: { template: '<div>workspace</div>' } }],
    })
    await router.push('/')
    await router.isReady()
    const { queryByText } = renderLayout(router, { bootstrapLoadingVisible: false })

    expect(queryByText('Restoring workspace')).toBeNull()
    expect(queryByText('workspace')).toBeNull()
    await waitFor(() =>
      expect(document.querySelector('[data-testid="bootstrap-loading-visible"]')?.textContent).toBe('true'),
    )
  })

  test('hides bootstrap loading when workspace restore completes', async () => {
    authenticatedBootstrapState.value = { status: 'ready' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'home', component: { template: '<div>workspace</div>' } }],
    })
    await router.push('/')
    await router.isReady()
    const { getByText } = renderLayout(router)

    expect(getByText('workspace')).toBeDefined()
    await waitFor(() =>
      expect(document.querySelector('[data-testid="bootstrap-loading-visible"]')?.textContent).toBe('false'),
    )
  })

  test('hides bootstrap loading when the settings surface can take over', async () => {
    authenticatedBootstrapState.value = { status: 'restoring-workspace' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/settings/general', name: 'settings', component: { template: '<div>settings</div>' } }],
    })
    await router.push('/settings/general')
    await router.isReady()
    const { getByText } = renderLayout(router)

    expect(getByText('settings')).toBeDefined()
    await waitFor(() =>
      expect(document.querySelector('[data-testid="bootstrap-loading-visible"]')?.textContent).toBe('false'),
    )
  })

  test('does not classify a similarly prefixed not-found route as settings', async () => {
    authenticatedBootstrapState.value = { status: 'restoring-workspace' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/settings/:page', name: 'settings', component: { template: '<div>settings</div>' } },
        { path: '/:pathMatch(.*)*', name: 'not-found', component: { template: '<div>not found</div>' } },
      ],
    })
    await router.push('/settings-unknown')
    await router.isReady()
    const { queryByText } = renderLayout(router)

    expect(document.querySelector('[data-testid="bootstrap-loading-visible"]')?.textContent).toBe('true')
    expect(queryByText('settings')).toBeNull()
  })

  test('shows bootstrap loading when leaving settings before workspace restore completes', async () => {
    authenticatedBootstrapState.value = { status: 'restoring-workspace' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/settings/general', name: 'settings', component: { template: '<div>settings</div>' } },
        { path: '/', name: 'home', component: { template: '<div>workspace</div>' } },
      ],
    })
    await router.push('/settings/general')
    await router.isReady()
    renderLayout(router)
    await waitFor(() =>
      expect(document.querySelector('[data-testid="bootstrap-loading-visible"]')?.textContent).toBe('false'),
    )

    await flushTestUpdates(async () => await router.push('/'))

    expect(document.querySelector('[data-testid="bootstrap-loading-visible"]')?.textContent).toBe('true')
  })

  test('keeps one loading node across the authentication and workspace restore handoff', async () => {
    authMock.status.state = 'unauthenticated'
    authenticatedBootstrapState.value = { status: 'restoring-workspace' }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'home', component: { template: '<div>workspace</div>' } }],
    })
    await router.push('/')
    await router.isReady()
    renderLayout(router)

    await waitFor(() => expect(document.querySelector('[role="status"]')).toBeNull())

    await flushTestUpdates(() => {
      authMock.status.state = 'checking'
    })
    const authenticationStatus = document.querySelector('[role="status"]')
    const authenticationSpinner = authenticationStatus?.querySelector('svg')
    expect(authenticationStatus).not.toBeNull()
    expect(authenticationSpinner).not.toBeNull()

    await flushTestUpdates(() => {
      authMock.status.state = 'authenticated'
    })

    expect(document.querySelector('[role="status"]')).toBe(authenticationStatus)
    expect(document.querySelector('[role="status"] svg')).toBe(authenticationSpinner)

    await flushTestUpdates(() => {
      authenticatedBootstrapState.value = { status: 'ready' }
    })

    await waitFor(() => expect(document.querySelector('[role="status"]')).toBeNull())
  })

  test('shows loading throughout workspace restore retry and hides it when ready', async () => {
    const user = userEvent.setup()
    authenticatedBootstrapState.value = { status: 'failed', message: 'Workspace restore failed for test' }
    authenticatedBootstrapMock.retry.mockImplementationOnce(() => {
      authenticatedBootstrapState.value = { status: 'restoring-workspace' }
    })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'home', component: { template: '<div>workspace</div>' } }],
    })
    await router.push('/')
    await router.isReady()
    const { getByRole, getByText, queryByText } = renderLayout(router)

    expect(getByText('Workspace restore failed for test')).toBeDefined()
    await waitFor(() =>
      expect(document.querySelector('[data-testid="bootstrap-loading-visible"]')?.textContent).toBe('false'),
    )
    await user.click(getByRole('button'))
    expect(authenticatedBootstrapMock.retry).toHaveBeenCalledOnce()
    await waitFor(() => expect(document.querySelector('[role="status"]')).not.toBeNull())
    expect(queryByText('Workspace restore failed for test')).toBeNull()

    await flushTestUpdates(() => {
      authenticatedBootstrapState.value = { status: 'ready' }
    })

    expect(getByText('workspace')).toBeDefined()
    await waitFor(() => expect(document.querySelector('[role="status"]')).toBeNull())
  })

  test('reveals an inner render failure and restores loading when the boundary retries', async () => {
    const user = userEvent.setup()
    authenticatedBootstrapState.value = { status: 'restoring-workspace' }
    workspaceOpenDialogMock.renderError = new Error('layout overlay render failed')
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'home', component: { template: '<div>workspace</div>' } }],
    })
    await router.push('/')
    await router.isReady()
    const { getByRole, getByText, queryByText } = renderLayout(router)

    await waitFor(() => expect(getByText('layout overlay render failed')).toBeDefined())
    expect(document.querySelector('[role="status"]')).toBeNull()

    workspaceOpenDialogMock.renderError = null
    await user.click(getByRole('button'))

    await waitFor(() => expect(document.querySelector('[role="status"]')).not.toBeNull())
    expect(queryByText('layout overlay render failed')).toBeNull()

    await flushTestUpdates(() => {
      authenticatedBootstrapState.value = { status: 'ready' }
    })
    await waitFor(() => expect(document.querySelector('[role="status"]')).toBeNull())
  })
})

function renderLayout(router: ReturnType<typeof createRouter>, options: { bootstrapLoadingVisible?: boolean } = {}) {
  return renderInJsdom(
    <BootstrapLoadingTestScope visible={options.bootstrapLoadingVisible ?? true}>
      <VueQueryClientScope client={layoutQueryClient}>
        <Layout />
      </VueQueryClientScope>
    </BootstrapLoadingTestScope>,
    { global: { plugins: [router] } },
  )
}

const BootstrapLoadingTestScope = defineComponent<{ visible: boolean }>({
  name: 'BootstrapLoadingTestScope',
  props: {
    visible: { type: Boolean, required: true },
  },
  setup(props, { slots }) {
    const bootstrapLoading = provideBootstrapLoadingPresentation()
    if (!props.visible) bootstrapLoading.hide()
    return () => (
      <>
        <span data-testid="bootstrap-loading-visible">{String(bootstrapLoading.visible.value)}</span>
        {slots.default?.()}
        {bootstrapLoading.visible.value ? <CenteredLoadingStatus label="Loading" /> : null}
      </>
    )
  },
})
