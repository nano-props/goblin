// Web IPC bridge helpers used by tests that need to simulate the
// Goblin client's interaction with the embedded server. They live
// here so non-repo tests (e.g. workspace, settings, branch actions)
// can depend on the same IPC + bridge plumbing without pulling in
// the repo store.
//
// Design choices:
//   - `handlers` is a `Record<string, IpcTestHandler>` keyed by IPC
//     pathname (`'repo.probe'`, `'repo.projection'`, etc.) and server
//     route (`'/api/repo/probe'`, etc.). `installGoblinTestBridge`
//     wires each pathname to the matching fetch URL.
//   - The bridge mock composes the same `goblinNative` shape the real
//     client bridge exposes, including `host`, `terminal`, `invokeIpc`,
//     and `onEvent`.
//   - `seedRepoShellForTest`, `seedRepoWithReadModelForTest`, and
//     `resetReposStore` interact with the live `useReposStore`
//     (Zustand) — they do not mock the store; they drive it. Tests
//     that need a fresh store call `resetReposStore` in `beforeEach`.

import type { RepoState, RepoBranchState } from '#/web/stores/repos/types.ts'
import { readRepoBranchQueryProjection, type RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'
import { stripBranchWorktreeMetadata } from '#/web/stores/repos/worktree-state.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { disposeAllRepoOperationSchedulers } from '#/web/stores/repos/repo-operation-scheduler.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import type { ClientBridge } from '#/web/client-bridge-types.ts'
import type { RepoRuntimeProjection } from '#/shared/api-types.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { resetAcceptedRepoProjectionReadModelState } from '#/web/stores/repos/projection-read-model-effects.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import { setRepoProjectionQueryData } from '#/web/repo-data-query.ts'
import {
  workspacePaneTabsWithStaticTab,
  workspacePaneTabsWithoutStaticTab,
} from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { workspacePaneTabEntryIdentity, workspacePaneTabsWithRuntimeTab } from '#/shared/workspace-pane.ts'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { DEFAULT_ZEN_MODE, DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
import type {
  TerminalAttachResult,
  TerminalRestartResult,
  TerminalMutationResult,
  TerminalWriteResult,
  TerminalSessionsRecoveryResult,
  TerminalTakeoverResult,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry, WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneTabsEntry,
  WorkspacePaneTabsListInput,
  WorkspacePaneTabsReplaceInput,
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateInput,
} from '#/shared/workspace-pane-tabs.ts'
import { WORKSPACE_PANE_TABS_SOCKET_ACTIONS } from '#/shared/workspace-pane-tabs.ts'
import {
  WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS,
  type WorkspacePaneRuntimeCloseResult,
  type WorkspacePaneRuntimeOpenResult,
} from '#/shared/workspace-pane-runtime.ts'
import type { BranchSnapshotInfo, PullRequestInfo, WorktreeStatus } from '#/web/types.ts'
import { vi } from 'vitest'
import { installWebSocketMock } from '#/web/test-utils/websocket-mock.ts'
import { createOpaqueId } from '#/shared/opaque-id.ts'

export type IpcTestHandler = (input: any) => unknown
export type RepoPresentationForTest = RepoState & {
  branchAction: RepoState['operations']['branchAction']
  branchModel: RepoBranchReadModelData
}

export function repoPresentationForTest(
  repo: RepoState,
  branchReadModel: RepoBranchReadModelData,
): RepoPresentationForTest {
  return {
    ...repo,
    branchAction: repo.operations.branchAction,
    branchModel: branchReadModel,
  }
}

export function repoPresentationFromQueryForTest(repo: RepoState): RepoPresentationForTest {
  const readModel = readRepoBranchQueryProjection(repo)
  if (!readModel) throw new Error(`missing branch read model for test repo: ${repo.id}`)
  return {
    ...repo,
    branchAction: repo.operations.branchAction,
    branchModel: readModel,
  }
}

export function seedRepoShellForTest(options: {
  id: string
  name?: string
  currentBranchName?: string | null
  preferredWorkspacePaneTabByTarget?: Record<string, WorkspacePaneTabType | null>
  repoRuntimeId?: string
  remote?: Partial<RepoState['remote']>
}): RepoState {
  const base = emptyRepo(options.id, options.name ?? 'repo', options.repoRuntimeId ?? createOpaqueId('repo-runtime'))
  const repo: RepoState = {
    ...base,
    ui: {
      ...base.ui,
      preferredWorkspacePaneTabByTarget:
        options.preferredWorkspacePaneTabByTarget ?? base.ui.preferredWorkspacePaneTabByTarget,
    },
    remote: {
      ...base.remote,
      ...options.remote,
    },
  }
  useReposStore.setState({
    repos: { [options.id]: repo },
    repoSnapshotCache: {},
    order: [options.id],
    restoredRepoId: options.id,
    workspaceMembershipReady: true,
    sessionPersistenceReady: true,
    sessionRestoreError: null,
    restoredClientWorkspaceBaseline: null,
    zenMode: DEFAULT_ZEN_MODE,
    workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
  })
  return repo
}

interface TerminalClientTestOutputs {
  'terminal.attach': TerminalAttachResult
  'terminal.restart': TerminalRestartResult
  'terminal.write': TerminalWriteResult
  'terminal.resize': TerminalMutationResult
  'terminal.takeover': TerminalTakeoverResult
  'terminal.close': TerminalMutationResult
  'terminal.prune': { pruned: number; remaining: number }
  'terminal.recoverSessions': TerminalSessionsRecoveryResult
  'terminal.notifyBell': TerminalMutationResult
  'workspacePaneTabs.replace': WorkspacePaneTabsSnapshot
  'workspacePaneTabs.update': WorkspacePaneTabsSnapshot
  'workspacePaneTabs.list': WorkspacePaneTabsSnapshot
  'workspacePaneRuntime.open': WorkspacePaneRuntimeOpenResult
  'workspacePaneRuntime.close': WorkspacePaneRuntimeCloseResult
}

function terminalHandlerNameForSocketAction(action: string): keyof TerminalClientTestOutputs | null {
  switch (action) {
    case 'attach':
      return 'terminal.attach'
    case 'restart':
      return 'terminal.restart'
    case 'write':
      return 'terminal.write'
    case 'resize':
      return 'terminal.resize'
    case 'takeover':
      return 'terminal.takeover'
    case 'close':
      return 'terminal.close'
    case WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace:
      return 'workspacePaneTabs.replace'
    case WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update:
      return 'workspacePaneTabs.update'
    case WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list:
      return 'workspacePaneTabs.list'
    case WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open:
      return 'workspacePaneRuntime.open'
    case WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close:
      return 'workspacePaneRuntime.close'
    case 'prune':
      return 'terminal.prune'
    case 'recover-sessions':
      return 'terminal.recoverSessions'
    default:
      return null
  }
}

export function createBranchSnapshot(name: string, options: Partial<BranchSnapshotInfo> = {}): BranchSnapshotInfo {
  return {
    name,
    isCurrent: false,
    ahead: 0,
    behind: 0,
    lastCommitHash: '',
    lastCommitShortHash: '',
    lastCommitMessage: '',
    lastCommitDate: '',
    lastCommitAuthor: '',
    ...options,
  }
}

export function createRepoBranch(name: string, options: Partial<RepoBranchState> = {}): RepoBranchState {
  return stripBranchWorktreeMetadata([createBranchSnapshot(name, options)])[0]!
}

export function createPullRequest(number: number, options: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/repo/pull/${number}`,
    state: 'open',
    ...options,
  }
}

export function installWorkspacePaneTabsTestBridge(
  options: {
    replaceWorkspaceTabs?: (
      input: WorkspacePaneTabsReplaceInput,
    ) => WorkspacePaneTabEntry[] | Promise<WorkspacePaneTabEntry[]>
    updateWorkspaceTabs?: (
      input: WorkspacePaneTabsUpdateInput,
    ) => WorkspacePaneTabEntry[] | Promise<WorkspacePaneTabEntry[]>
    listWorkspaceTabs?: (
      input: WorkspacePaneTabsListInput,
    ) => WorkspacePaneTabsEntry[] | Promise<WorkspacePaneTabsEntry[]>
    onEffectIntent?: ClientBridge['onEffectIntent']
  } = {},
): void {
  let serverEntries: WorkspacePaneTabsEntry[] = []
  let serverRevision = 0
  const targetKey = (input: { repoRoot: string; branchName: string; worktreePath: string | null }) =>
    workspacePaneTabsTargetIdentityKey(input)
  const serverTabsForTarget = (input: {
    repoRoot: string
    repoRuntimeId: string
    branchName: string
    worktreePath: string | null
  }): WorkspacePaneTabEntry[] => {
    const entry = serverEntries.find((candidate) => targetKey(candidate) === targetKey(input))
    if (entry) return [...entry.tabs]
    const tabs = readWorkspacePaneTabsForTarget(input)
    const key = targetKey(input)
    serverEntries = [
      ...serverEntries.filter((candidate) => targetKey(candidate) !== key),
      { repoRoot: input.repoRoot, branchName: input.branchName, worktreePath: input.worktreePath, tabs },
    ]
    return tabs
  }
  const replaceServerTarget = (
    input: { repoRoot: string; branchName: string; worktreePath: string | null },
    tabs: readonly WorkspacePaneTabEntry[],
  ): WorkspacePaneTabEntry[] => {
    const nextTabs = [...tabs]
    const key = targetKey(input)
    serverEntries = [
      ...serverEntries.filter((entry) => targetKey(entry) !== key),
      { repoRoot: input.repoRoot, branchName: input.branchName, worktreePath: input.worktreePath, tabs: nextTabs },
    ]
    return nextTabs
  }
  const serverSnapshot = (): WorkspacePaneTabsSnapshot => ({
    revision: serverRevision,
    entries: serverEntries.map((entry) => ({ ...entry, tabs: [...entry.tabs] })),
  })
  const commitServerSnapshot = (): WorkspacePaneTabsSnapshot => {
    serverRevision += 1
    return serverSnapshot()
  }
  setClientBridgeForTests({
    kind: () => 'web',
    hasCapability: () => false,
    getBootstrap: () => ({
      runtime: {
        kind: 'web',
        bridgeVersion: CLIENT_BRIDGE_VERSION,
        capabilities: [],
      },
      homeDir: '/Users/test',
      platform: 'web',
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
    }),
    invokeIpc: async ({ path }) => {
      throw new Error(`Unhandled IPC path: ${path}`)
    },
    abortIpc: async () => false,
    onIpcEvent: () => () => {},
    onEffectIntent: options.onEffectIntent ?? (() => () => {}),
    pathForFile: () => '',
    saveClipboardFiles: async () => [],
    host: () => null,
    appRealtime: () => ({
      kickReconnect: () => {},
      onRecovered: () => () => {},
    }),
    terminal: () => ({
      attach: async () => ({ ok: false, message: 'unhandled terminal attach' }),
      restart: async () => ({ ok: false, message: 'unhandled terminal restart' }),
      write: async () => ({ status: 'accepted' }),
      resize: async () => true,
      takeover: async () => ({
        ok: true as const,
        terminalRuntimeSessionId: 'pty_test_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        role: 'controller' as const,
        controllerStatus: 'connected' as const,
        controller: { clientId: 'attachment_local', status: 'connected' as const },
        canonicalCols: 80,
        canonicalRows: 24,
        phase: 'open' as const,
      }),
      close: async () => true,
      create: async () => ({
        ok: true as const,
        action: 'created' as const,
        terminalSessionId: 'term-testtesttesttesttest1',
        terminalSessionsRevision: 1,
        terminalRuntimeSessionId: 'pty_test_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        snapshot: '',
        snapshotSeq: 0,
        outputEra: 0,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open' as const,
        message: null,
        controller: { clientId: 'attachment_local', status: 'connected' as const },
        canonicalCols: 80,
        canonicalRows: 24,
      }),
      pruneTerminals: async () => ({ pruned: 0, remaining: 0 }),
      recoverSessions: async () => ({
        terminalSessions: { revision: 0, sessions: [] },
        snapshots: [],
        workspacePaneTabs: { revision: 0, entries: [] },
      }),
      notifyBell: async () => true,
      sendTestNotification: async () => true,
      setBadge: () => {},
      onOutput: () => () => {},
      onBell: () => () => {},
      onTitle: () => () => {},
      onExit: () => () => {},
      onIdentity: () => () => {},
      onLifecycle: () => () => {},
      onSessionsChanged: () => () => {},
      onSessionClosed: () => () => {},
    }),
    workspacePaneTabs: () => ({
      replace: async (input) => {
        const tabs = options.replaceWorkspaceTabs ? await options.replaceWorkspaceTabs(input) : [...input.tabs]
        replaceServerTarget(input, tabs)
        return commitServerSnapshot()
      },
      update: async (input) => {
        if (options.updateWorkspaceTabs) serverTabsForTarget(input)
        const tabs = options.updateWorkspaceTabs
          ? await options.updateWorkspaceTabs(input)
          : defaultWorkspacePaneTabsOperationResult(input, serverTabsForTarget(input))
        replaceServerTarget(input, tabs)
        return commitServerSnapshot()
      },
      list: async (input) => {
        if (options.listWorkspaceTabs) {
          serverEntries = (await options.listWorkspaceTabs(input)).map((entry) => ({
            ...entry,
            tabs: [...entry.tabs],
          }))
        }
        return {
          revision: serverRevision,
          entries: serverEntries.filter((entry) => entry.repoRoot === input.repoRoot),
        }
      },
      onChanged: () => () => {},
    }),
    workspacePaneRuntime: () => ({
      open: async (input) => {
        const terminalSessionId = 'term-testtesttesttesttest1'
        const terminalRuntimeSessionId = 'pty_test_aaaaaaaaa'
        const target = {
          repoRoot: input.request.repoRoot,
          repoRuntimeId: input.request.repoRuntimeId,
          branchName: input.request.branch,
          worktreePath: input.request.worktreePath,
        }
        replaceServerTarget(
          target,
          workspacePaneTabsWithRuntimeTab(serverTabsForTarget(target), 'terminal', terminalSessionId, {
            insertAfterIdentity: input.insertAfterIdentity,
          }),
        )
        return {
          ok: true,
          runtimeType: 'terminal',
          runtime: {
            ok: true,
            action: 'created',
            terminalSessionId,
            terminalSessionsRevision: 1,
            terminalRuntimeSessionId,
            terminalRuntimeGeneration: 1,
            snapshot: '',
            snapshotSeq: 0,
            outputEra: 0,
            processName: 'zsh',
            canonicalTitle: null,
            phase: 'open',
            message: null,
            controller: { clientId: input.request.clientId ?? 'attachment_local', status: 'connected' },
            canonicalCols: input.request.cols ?? 80,
            canonicalRows: input.request.rows ?? 24,
          },
          workspacePaneTabs: commitServerSnapshot(),
        } as const
      },
      close: async (input) => {
        const currentTabs = serverTabsForTarget(input.target)
        const wasOpen = currentTabs.some(
          (tab) => tab.type === input.runtimeType && tab.runtimeSessionId === input.sessionId,
        )
        replaceServerTarget(
          input.target,
          currentTabs.filter((tab) => tab.type !== input.runtimeType || tab.runtimeSessionId !== input.sessionId),
        )
        return {
          ok: true,
          runtimeType: input.runtimeType,
          runtime: {
            action: wasOpen ? ('closed' as const) : ('already-closed' as const),
            terminalSessionId: input.sessionId,
            terminalRuntimeSessionId: wasOpen ? 'pty_test_aaaaaaaaa' : null,
            terminalRuntimeGeneration: wasOpen ? 1 : null,
          },
          workspacePaneTabs: commitServerSnapshot(),
        }
      },
    }),
  } satisfies ClientBridge)
}

function defaultWorkspacePaneTabsOperationResult(
  input: WorkspacePaneTabsUpdateInput,
  currentTabs: readonly WorkspacePaneTabEntry[],
): WorkspacePaneTabEntry[] {
  switch (input.operation.type) {
    case 'open-static':
      return workspacePaneTabsWithStaticTab(currentTabs, input.operation.tabType, {
        insertAfterIdentity: input.operation.insertAfterIdentity,
      })
    case 'close-static':
      return workspacePaneTabsWithoutStaticTab(currentTabs, input.operation.tabType)
    case 'reorder':
      return workspacePaneTabsWithIdentityOrder(currentTabs, input.operation.tabIdentities)
  }
}

function isWorkspacePaneTabsUpdateInput(value: unknown): value is WorkspacePaneTabsUpdateInput {
  if (!value || typeof value !== 'object') return false
  const input = value as { repoRoot?: unknown; branchName?: unknown; worktreePath?: unknown; operation?: unknown }
  return (
    typeof input.repoRoot === 'string' &&
    typeof input.branchName === 'string' &&
    (typeof input.worktreePath === 'string' || input.worktreePath === null) &&
    !!input.operation &&
    typeof input.operation === 'object'
  )
}

function isWorkspacePaneTabsReplaceInput(value: unknown): value is WorkspacePaneTabsReplaceInput {
  if (!value || typeof value !== 'object') return false
  const input = value as {
    repoRoot?: unknown
    repoRuntimeId?: unknown
    branchName?: unknown
    worktreePath?: unknown
    tabs?: unknown
  }
  return (
    typeof input.repoRoot === 'string' &&
    typeof input.repoRuntimeId === 'string' &&
    typeof input.branchName === 'string' &&
    (typeof input.worktreePath === 'string' || input.worktreePath === null) &&
    Array.isArray(input.tabs)
  )
}

function workspacePaneTabsWithIdentityOrder(
  currentTabs: readonly WorkspacePaneTabEntry[],
  tabIdentities: readonly string[],
): WorkspacePaneTabEntry[] {
  const tabByIdentity = new Map(currentTabs.map((tab) => [workspacePaneTabEntryIdentity(tab), tab]))
  const used = new Set<string>()
  const ordered: WorkspacePaneTabEntry[] = []
  for (const identity of tabIdentities) {
    const tab = tabByIdentity.get(identity)
    if (!tab || used.has(identity)) continue
    used.add(identity)
    ordered.push(tab)
  }
  for (const tab of currentTabs) {
    const identity = workspacePaneTabEntryIdentity(tab)
    if (used.has(identity)) continue
    used.add(identity)
    ordered.push(tab)
  }
  return ordered
}

export function resetReposStore(): void {
  disposeAllRepoOperationSchedulers()
  resetAcceptedRepoProjectionReadModelState()
  primaryWindowQueryClient.clear()
  useReposStore.setState({
    repos: {},
    repoSnapshotCache: {},
    order: [],
    restoredRepoId: null,
    workspaceMembershipReady: false,
    sessionPersistenceReady: false,
    sessionRestoreError: null,
    restoredClientWorkspaceBaseline: null,
    zenMode: DEFAULT_ZEN_MODE,
    workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
    selectedTerminalSessionIdByTerminalWorktree: {},
    tabOpenerIdentityByScope: {},
    navigationHistoryByRepo: {},
  })
}

export function installGoblinTestBridge(handlers: Record<string, IpcTestHandler>): void {
  const repoRuntimeState = new Map<string, { currentRepoRuntimeId: string | null; members: Set<string> }>()
  const sessionStorageValues = new Map<string, string>()
  const hostOpenExternalUrl = handlers['app.openExternalUrl']
  const hostOpenDirectoryDialog = handlers['repo.openDialog']
  const hostConsumeExternalOpenPaths = handlers['repo.consumeExternalOpenPaths']
  const hostOpenSettingsWindow = handlers['app.openSettingsWindow']
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __GOBLIN_BOOTSTRAP__: {
        homeDir: '/Users/test',
        platform: 'web',
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
      },
      goblinNative: {
        homeDir: '/Users/test',
        platform: 'web',
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
        invokeIpc: ({ path, input }: { path: string; input?: unknown }) => {
          const handler = handlers[path]
          if (!handler) throw new Error(`Unhandled IPC path: ${path}`)
          return handler(input)
        },
        abortIpc: () => Promise.resolve(false),
        onEvent: () => () => {},
        pathForFile: () => '',
        host: {
          openSettingsWindow: (input: unknown) =>
            hostOpenSettingsWindow ? Promise.resolve(hostOpenSettingsWindow(input)) : Promise.resolve(false),
          openExternalUrl: (input: unknown) =>
            hostOpenExternalUrl
              ? Promise.resolve(hostOpenExternalUrl(input))
              : Promise.resolve({ ok: false, message: 'error.invalid-url' }),
          openDirectoryDialog: (input: { title?: string }) => {
            const handler =
              input?.title === 'Choose Clone Destination' && handlers['repo.cloneParentDialog']
                ? handlers['repo.cloneParentDialog']
                : hostOpenDirectoryDialog
            return handler ? Promise.resolve(handler(input)) : Promise.resolve(null)
          },
          consumeExternalOpenPaths: () =>
            hostConsumeExternalOpenPaths
              ? Promise.resolve(hostConsumeExternalOpenPaths(undefined))
              : Promise.resolve([]),
        },
        terminal: {
          attach: () => Promise.resolve({ ok: false, message: 'unhandled terminal attach' }),
          restart: () => Promise.resolve({ ok: false, message: 'unhandled terminal restart' }),
          write: () => Promise.resolve({ status: 'accepted' }),
          resize: () => Promise.resolve(true),
          takeover: () =>
            Promise.resolve({
              ok: true as const,
              terminalRuntimeSessionId: 'pty_test_aaaaaaaaa',
              terminalRuntimeGeneration: 1,
              role: 'controller' as const,
              controllerStatus: 'connected' as const,
              controller: { clientId: 'attachment_local', status: 'connected' as const },
              canonicalCols: 80,
              canonicalRows: 24,
              phase: 'open' as const,
            }),
          close: () => Promise.resolve(true),
          pruneTerminals: () => Promise.resolve({ pruned: 0, remaining: 0 }),
          recoverSessions: () =>
            Promise.resolve({
              terminalSessions: { revision: 0, sessions: [] },
              snapshots: [],
              workspacePaneTabs: { revision: 0, entries: [] },
            }),
          notifyBell: () => Promise.resolve(true),
          sendTestNotification: () => Promise.resolve(true),
          setBadge: () => {},
          onOutput: () => () => {},
          onBell: () => () => {},
          onTitle: () => () => {},
          onExit: () => () => {},
          onIdentity: () => () => {},
          onLifecycle: () => () => {},
          onSessionsChanged: () => () => {},
          onSessionClosed: () => () => {},
        },
      },
      location: {
        href: 'http://127.0.0.1:32100/',
        origin: 'http://127.0.0.1:32100',
        search: '',
      },
      sessionStorage: {
        getItem: (key: string) => sessionStorageValues.get(key) ?? null,
        setItem: (key: string, value: string) => sessionStorageValues.set(key, value),
      },
    },
  })
  function callTerminalHandler(name: 'terminal.attach', payload: unknown): TerminalClientTestOutputs['terminal.attach']
  function callTerminalHandler(
    name: 'terminal.restart',
    payload: unknown,
  ): TerminalClientTestOutputs['terminal.restart']
  function callTerminalHandler(name: 'terminal.write', payload: unknown): TerminalClientTestOutputs['terminal.write']
  function callTerminalHandler(name: 'terminal.resize', payload: unknown): TerminalClientTestOutputs['terminal.resize']
  function callTerminalHandler(
    name: 'terminal.takeover',
    payload: unknown,
  ): TerminalClientTestOutputs['terminal.takeover']
  function callTerminalHandler(name: 'terminal.close', payload: unknown): TerminalClientTestOutputs['terminal.close']
  function callTerminalHandler(
    name: 'workspacePaneTabs.replace',
    payload: unknown,
  ): TerminalClientTestOutputs['workspacePaneTabs.replace']
  function callTerminalHandler(
    name: 'workspacePaneTabs.update',
    payload: unknown,
  ): TerminalClientTestOutputs['workspacePaneTabs.update']
  function callTerminalHandler(
    name: 'workspacePaneTabs.list',
    payload: unknown,
  ): TerminalClientTestOutputs['workspacePaneTabs.list']
  function callTerminalHandler(
    name: 'workspacePaneRuntime.open',
    payload: unknown,
  ): TerminalClientTestOutputs['workspacePaneRuntime.open']
  function callTerminalHandler(
    name: 'workspacePaneRuntime.close',
    payload: unknown,
  ): TerminalClientTestOutputs['workspacePaneRuntime.close']
  function callTerminalHandler(name: 'terminal.prune', payload: unknown): TerminalClientTestOutputs['terminal.prune']
  function callTerminalHandler(
    name: 'terminal.recoverSessions',
    payload: unknown,
  ): TerminalClientTestOutputs['terminal.recoverSessions']
  function callTerminalHandler(
    name: 'terminal.notifyBell',
    payload: unknown,
  ): TerminalClientTestOutputs['terminal.notifyBell']
  function callTerminalHandler(
    name: keyof TerminalClientTestOutputs,
    payload: unknown,
  ): TerminalClientTestOutputs[keyof TerminalClientTestOutputs]
  function callTerminalHandler(
    name: keyof TerminalClientTestOutputs,
    payload: unknown,
  ): TerminalClientTestOutputs[keyof TerminalClientTestOutputs] {
    const handler = handlers[name]
    if (!handler) {
      switch (name) {
        case 'terminal.attach':
        case 'terminal.restart':
          return { ok: false, message: `unhandled ${name}` }
        case 'terminal.write':
          return { status: 'accepted' } satisfies TerminalWriteResult
        case 'terminal.resize':
        case 'terminal.close':
        case 'terminal.notifyBell':
          return true satisfies TerminalMutationResult
        case 'terminal.takeover':
          return {
            ok: true as const,
            terminalRuntimeSessionId: 'pty_test_aaaaaaaaa',
            terminalRuntimeGeneration: 1,
            role: 'controller' as const,
            controllerStatus: 'connected' as const,
            controller: { clientId: 'attachment_local', status: 'connected' as const },
            canonicalCols: 80,
            canonicalRows: 24,
            phase: 'open' as const,
          }
        case 'terminal.prune':
          return { pruned: 0, remaining: 0 }
        case 'workspacePaneTabs.replace':
          return {
            revision: 1,
            entries: isWorkspacePaneTabsReplaceInput(payload)
              ? [
                  {
                    repoRoot: payload.repoRoot,
                    branchName: payload.branchName,
                    worktreePath: payload.worktreePath,
                    tabs: [...payload.tabs],
                  },
                ]
              : [],
          }
        case 'workspacePaneTabs.update': {
          const input = isWorkspacePaneTabsUpdateInput(payload) ? payload : null
          return {
            revision: 1,
            entries: input
              ? [
                  {
                    repoRoot: input.repoRoot,
                    branchName: input.branchName,
                    worktreePath: input.worktreePath,
                    tabs: defaultWorkspacePaneTabsOperationResult(input, readWorkspacePaneTabsForTarget(input)),
                  },
                ]
              : [],
          }
        }
        case 'workspacePaneTabs.list':
          return { revision: 0, entries: [] }
        case 'workspacePaneRuntime.close': {
          const runtimeType =
            (payload as { runtimeType?: WorkspacePaneRuntimeCloseResult['runtimeType'] } | null)?.runtimeType ??
            'terminal'
          const terminalSessionId =
            (payload as { sessionId?: string } | null)?.sessionId ?? 'term-testtesttesttesttest1'
          return {
            ok: true,
            runtimeType,
            runtime: {
              action: 'closed',
              terminalSessionId,
              terminalRuntimeSessionId: 'pty_test_aaaaaaaaa',
              terminalRuntimeGeneration: 1,
            },
            workspacePaneTabs: { revision: 1, entries: [] },
          }
        }
        case 'terminal.recoverSessions':
          return {
            terminalSessions: { revision: 0, sessions: [] },
            snapshots: [],
            workspacePaneTabs: { revision: 0, entries: [] },
          }
      }
    }
    return handler(payload) as TerminalClientTestOutputs[keyof TerminalClientTestOutputs]
  }
  // Use the shared `installWebSocketMock` for the WebSocket surface and
  // wrap each new socket's `send` so JSON `request` frames are routed to
  // the matching terminal handler and the response is emitted back over
  // the same socket. This keeps one canonical `MockWebSocket` shape
  // across `src/web/test-utils/`, instead of a second inline copy.
  const socketMock = installWebSocketMock({ autoOpen: true })
  const OriginalSend = socketMock.MockWebSocket.prototype.send
  socketMock.MockWebSocket.prototype.send = function patchedSend(
    this: InstanceType<typeof socketMock.MockWebSocket>,
    data: string,
  ) {
    OriginalSend.call(this, data)
    let parsed: { type?: string; requestId?: string; action?: string; input?: unknown } | null = null
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    if (parsed?.type !== 'request' || !parsed.requestId || typeof parsed.action !== 'string') return
    const handlerName = terminalHandlerNameForSocketAction(parsed.action)
    if (!handlerName) return
    Promise.resolve()
      .then(() => callTerminalHandler(handlerName, parsed.input))
      .then(
        (payload) => {
          this.emit('message', {
            data: JSON.stringify({
              type: 'response',
              requestId: parsed?.requestId,
              ok: true,
              action: parsed?.action,
              payload,
            }),
          })
        },
        (error) => {
          this.emit('message', {
            data: JSON.stringify({
              type: 'response',
              requestId: parsed?.requestId,
              ok: false,
              action: parsed?.action,
              error: error instanceof Error ? error.message : String(error),
            }),
          })
        },
      )
  }
  setClientBridgeForTests({
    kind: () => 'electron',
    hasCapability: () => false,
    getBootstrap: () => ({
      runtime: {
        kind: 'electron',
        bridgeVersion: CLIENT_BRIDGE_VERSION,
        capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
      },
      homeDir: '/Users/test',
      platform: 'web',
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
    }),
    invokeIpc: async ({ path, input }: { path: string; input?: unknown }) => {
      const handler = handlers[path]
      if (!handler) throw new Error(`Unhandled IPC path: ${path}`)
      return handler(input)
    },
    abortIpc: async () => false,
    onIpcEvent: () => () => {},
    onEffectIntent: () => () => {},
    pathForFile: () => '',
    saveClipboardFiles: () => Promise.resolve([]),
    host: () => window.goblinNative.host ?? null,
    appRealtime: () => ({
      kickReconnect: () => {},
      onRecovered: () => () => {},
    }),
    terminal: () => ({
      attach: async (input) => callTerminalHandler('terminal.attach', input),
      restart: async (input) => callTerminalHandler('terminal.restart', input),
      write: async (input) => callTerminalHandler('terminal.write', input),
      resize: async (input) => callTerminalHandler('terminal.resize', input),
      takeover: async (input) => callTerminalHandler('terminal.takeover', input),
      pruneTerminals: async (repoRoot) => callTerminalHandler('terminal.prune', { repoRoot }),
      recoverSessions: async (input) => callTerminalHandler('terminal.recoverSessions', input),
      notifyBell: async (input) => callTerminalHandler('terminal.notifyBell', input),
      sendTestNotification: async () => true,
      setBadge: () => {},
      onOutput: () => () => {},
      onBell: () => () => {},
      onTitle: () => () => {},
      onExit: () => () => {},
      onIdentity: () => () => {},
      onLifecycle: () => () => {},
      onSessionsChanged: () => () => {},
      onSessionClosed: () => () => {},
    }),
    workspacePaneTabs: () => ({
      replace: async (input) => callTerminalHandler('workspacePaneTabs.replace', input),
      update: async (input) => callTerminalHandler('workspacePaneTabs.update', input),
      list: async (input) => callTerminalHandler('workspacePaneTabs.list', input),
      onChanged: () => () => {},
    }),
    workspacePaneRuntime: () => ({
      open: async (input) => callTerminalHandler('workspacePaneRuntime.open', input),
      close: async (input) => callTerminalHandler('workspacePaneRuntime.close', input),
    }),
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      const body =
        typeof init?.body === 'string' && init.body.length > 0 ? (JSON.parse(init.body) as Record<string, unknown>) : {}
      const call = (name: string, payload: unknown) => {
        const handler = handlers[name]
        if (!handler) {
          throw new Error(`Unhandled server route: ${name}`)
        }
        return handler(payload)
      }
      const readRepoProjection = async (payload: Record<string, unknown>) => {
        const cwd = typeof payload.cwd === 'string' ? payload.cwd : ''
        const branch = typeof payload.branch === 'string' && payload.branch.length > 0 ? payload.branch : null
        const mode = payload.mode === 'summary' ? 'summary' : 'full'
        const normalizeProjection = (raw: unknown) => {
          const projection = raw as {
            snapshot?: unknown
            status?: unknown
            pullRequests?: unknown
            operations?: unknown
            requested?: unknown
            loadedAt?: unknown
          }
          return {
            snapshot: projection.snapshot ?? null,
            status: Array.isArray(projection.status) ? projection.status : [],
            pullRequests: projection.pullRequests ?? null,
            operations:
              projection.operations && typeof projection.operations === 'object'
                ? projection.operations
                : { operations: [], loadedAt: Date.now() },
            requested:
              projection.requested && typeof projection.requested === 'object'
                ? projection.requested
                : {
                    branch,
                    pullRequestMode: mode,
                  },
            loadedAt: typeof projection.loadedAt === 'number' ? projection.loadedAt : Date.now(),
          }
        }
        return normalizeProjection(await call('repo.projection', payload))
      }
      const openRepoRuntime = async (payload: unknown) => {
        const repoRoot = typeof payload === 'object' && payload && 'repoRoot' in payload ? payload.repoRoot : null
        const repoInput = typeof payload === 'object' && payload && 'repoInput' in payload ? payload.repoInput : null
        const clientId = typeof payload === 'object' && payload && 'clientId' in payload ? payload.clientId : null
        if (typeof clientId !== 'string' || clientId.length === 0) throw new Error('runtime-open requires clientId')
        if (typeof repoInput === 'string' && repoInput.length > 0) {
          const probe = (await call('repo.probe', { cwd: repoInput })) as {
            ok: boolean
            root?: string
            name?: string
            message?: string
          }
          if (!probe.ok || !probe.root) {
            return { ok: false as const, input: repoInput, reason: probe.message ?? 'error.not-git-repo' }
          }
          const state = repoRuntimeState.get(probe.root) ?? { currentRepoRuntimeId: null, members: new Set<string>() }
          if (!state.currentRepoRuntimeId) state.currentRepoRuntimeId = createOpaqueId('repo-runtime')
          state.members.add(clientId)
          repoRuntimeState.set(probe.root, state)
          return {
            ok: true as const,
            repo: { id: probe.root, name: probe.name ?? probe.root.split('/').at(-1) ?? probe.root },
            repoRuntimeId: state.currentRepoRuntimeId,
          }
        }
        if (typeof repoRoot !== 'string' || repoRoot.length === 0) throw new Error('runtime-open requires repoRoot')
        const state = repoRuntimeState.get(repoRoot) ?? { currentRepoRuntimeId: null, members: new Set<string>() }
        const repoRuntimeId = state.currentRepoRuntimeId ?? createOpaqueId('repo-runtime')
        state.currentRepoRuntimeId = repoRuntimeId
        state.members.add(clientId)
        repoRuntimeState.set(repoRoot, state)
        return { ok: true as const, repoRuntimeId }
      }
      const closeRepoRuntime = (payload: unknown) => {
        const repoRoot = typeof payload === 'object' && payload && 'repoRoot' in payload ? payload.repoRoot : null
        const repoRuntimeId =
          typeof payload === 'object' && payload && 'repoRuntimeId' in payload ? payload.repoRuntimeId : null
        const clientId = typeof payload === 'object' && payload && 'clientId' in payload ? payload.clientId : null
        if (typeof repoRoot !== 'string' || typeof repoRuntimeId !== 'string' || typeof clientId !== 'string') {
          throw new Error('runtime-close requires repoRoot, repoRuntimeId, and clientId')
        }
        const state = repoRuntimeState.get(repoRoot)
        const released = !!state && state.currentRepoRuntimeId === repoRuntimeId && state.members.delete(clientId)
        const runtimeClosed = released && !!state && state.members.size === 0
        if (runtimeClosed) state.currentRepoRuntimeId = null
        return { ok: true as const, released, runtimeClosed }
      }
      const reconcileRepoRuntimeMemberships = (payload: unknown) => {
        const clientId = typeof payload === 'object' && payload && 'clientId' in payload ? payload.clientId : null
        const repoRoots = typeof payload === 'object' && payload && 'repoRoots' in payload ? payload.repoRoots : null
        if (
          typeof clientId !== 'string' ||
          !Array.isArray(repoRoots) ||
          !repoRoots.every((root) => typeof root === 'string')
        ) {
          throw new Error('runtime-reconcile requires clientId and repoRoots')
        }
        const desired = new Set(repoRoots)
        for (const [repoRoot, state] of repoRuntimeState) {
          if (desired.has(repoRoot)) continue
          state.members.delete(clientId)
          if (state.members.size === 0) state.currentRepoRuntimeId = null
        }
        return {
          runtimes: repoRoots.map((repoRoot) => {
            const state = repoRuntimeState.get(repoRoot) ?? { currentRepoRuntimeId: null, members: new Set<string>() }
            state.currentRepoRuntimeId ??= createOpaqueId('repo-runtime')
            state.members.add(clientId)
            repoRuntimeState.set(repoRoot, state)
            return { repoRoot, repoRuntimeId: state.currentRepoRuntimeId }
          }),
        }
      }
      const listRepoRuntime = () => ({
        runtimes: Array.from(repoRuntimeState.entries()).flatMap(([repoRoot, state]) =>
          state.currentRepoRuntimeId ? [{ repoRoot, repoRuntimeId: state.currentRepoRuntimeId }] : [],
        ),
      })
      const result = (() => {
        if (url.pathname === '/api/settings') return call('settings.get', undefined)
        if (url.pathname === '/api/i18n') return call('i18n.get', undefined)
        if (url.pathname === '/api/settings/github-cli') return call('githubCli.get', body)
        if (url.pathname === '/api/settings/github-cli/refresh') return call('githubCli.refresh', body)
        if (url.pathname === '/api/settings/external-apps') {
          return init?.method === 'POST' ? call('externalApps.refresh', body) : call('externalApps.get', undefined)
        }
        if (url.pathname === '/api/settings/recent-repos/add') return call('settings.addRecentRepo', body)
        if (url.pathname === '/api/settings/workspace/restore') return call('settings.restoreWorkspace', body)
        if (url.pathname === '/api/settings/workspace/repos/add') return call('settings.addWorkspaceRepo', body)
        if (url.pathname === '/api/settings/workspace/repos/remove') return call('settings.removeWorkspaceRepo', body)
        if (url.pathname === '/api/settings/fetch-interval') return call('settings.setFetchInterval', body)
        if (url.pathname === '/api/settings/prefs') return call('settings.updateUserSettings', body)
        if (url.pathname === '/api/remote/ssh-hosts') return call('remote.listSshHosts', undefined)
        if (url.pathname === '/api/remote/resolve-target') return call('remote.resolveTarget', body)
        if (url.pathname === '/api/remote/lifecycle') return call('remote.lifecycle', body)
        if (url.pathname === '/api/remote/path-suggestions') return call('remote.listPathSuggestions', body)
        if (url.pathname === '/api/remote/test-repo') return call('remote.testRepo', body)
        if (url.pathname === '/api/repo/probe') return call('repo.probe', body)
        if (url.pathname === '/api/repo/log') return call('repo.log', body)
        if (url.pathname === '/api/repo/remote-branches') return call('repo.remoteBranches', body)
        if (url.pathname === '/api/repo/projection') return readRepoProjection(body)
        if (url.pathname === '/api/repo/operations') {
          return handlers['repo.operations'] ? call('repo.operations', body) : { operations: [], loadedAt: Date.now() }
        }
        if (url.pathname === '/api/repo/patch') return call('repo.patch', body)
        if (url.pathname === '/api/repo/fetch') return call('repo.fetch', body)
        if (url.pathname === '/api/repo/clone') return call('repo.clone', body)
        if (url.pathname === '/api/repo/pull') return call('repo.pull', body)
        if (url.pathname === '/api/repo/push') return call('repo.push', body)
        if (url.pathname === '/api/repo/create-worktree') return call('repo.createWorktree', body)
        if (url.pathname === '/api/repo/worktree-bootstrap-preview') return call('repo.worktreeBootstrapPreview', body)
        if (url.pathname === '/api/repo/delete-branch') return call('repo.deleteBranch', body)
        if (url.pathname === '/api/repo/remove-worktree') return call('repo.removeWorktree', body)
        if (url.pathname === '/api/repo/open-url') return call('repo.openUrl', body)
        if (url.pathname === '/api/repo/open-terminal') return call('repo.openTerminal', body)
        if (url.pathname === '/api/repo/open-editor') return call('repo.openEditor', body)
        if (url.pathname === '/api/repo/background-sync-repos') return call('repo.backgroundSyncRepos', body)
        if (url.pathname === '/api/repo/runtime-open') {
          return handlers['repo.runtimeOpen'] ? call('repo.runtimeOpen', body) : openRepoRuntime(body)
        }
        if (url.pathname === '/api/repo/runtime-list') {
          return handlers['repo.runtimeList'] ? call('repo.runtimeList', body) : listRepoRuntime()
        }
        if (url.pathname === '/api/repo/runtime-reconcile') {
          return handlers['repo.runtimeReconcile']
            ? call('repo.runtimeReconcile', body)
            : reconcileRepoRuntimeMemberships(body)
        }
        if (url.pathname === '/api/repo/runtime-close') {
          return handlers['repo.runtimeClose'] ? call('repo.runtimeClose', body) : closeRepoRuntime(body)
        }
        if (url.pathname === '/api/repo/abort') return call('repo.abort', body)
        throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      })()
      const abortError = () => {
        if (typeof DOMException !== 'undefined') return new DOMException('The operation was aborted.', 'AbortError')
        const err = new Error('The operation was aborted.')
        err.name = 'AbortError'
        return err
      }
      const withAbort = async <T>(value: T | Promise<T>): Promise<T> => {
        const signal = init?.signal
        if (!signal) return await value
        if (signal.aborted) throw abortError()
        return await new Promise<T>((resolve, reject) => {
          const onAbort = () => {
            signal.removeEventListener('abort', onAbort)
            reject(abortError())
          }
          signal.addEventListener('abort', onAbort, { once: true })
          Promise.resolve(value).then(
            (resolved) => {
              signal.removeEventListener('abort', onAbort)
              resolve(resolved)
            },
            (err) => {
              signal.removeEventListener('abort', onAbort)
              reject(err)
            },
          )
        })
      }
      return {
        ok: true,
        json: async () => await withAbort(result),
      }
    }),
  )
  setClientBridgeForTests(null)
}

export function seedRepoWithReadModelForTest(options: {
  id: string
  name?: string
  branches?: RepoBranchState[]
  branchSnapshots?: BranchSnapshotInfo[]
  currentBranch?: string
  currentBranchName?: string | null
  preferredWorkspacePaneTab?: WorkspacePaneTabType | null
  preferredWorkspacePaneTabByTarget?: Record<string, WorkspacePaneTabType | null>
  workspacePaneTabsByBranch?: Record<string, WorkspacePaneTabEntry[]>
  repoRuntimeId?: string
  status?: WorktreeStatus[]
  remote?: Partial<RepoState['remote']>
}): RepoState {
  const branchesWithSnapshotWorktreeMetadata = options.branchSnapshots ?? options.branches ?? []
  const branches = options.branches ?? stripBranchWorktreeMetadata(branchesWithSnapshotWorktreeMetadata)
  const status = options.status ?? []
  const currentBranchName = options.currentBranchName ?? null
  const preferredWorkspacePaneTabByTarget =
    options.preferredWorkspacePaneTabByTarget ??
    (currentBranchName && options.preferredWorkspacePaneTab !== undefined
      ? {
          [workspacePaneTabsTargetIdentityKey({
            repoRoot: options.id,
            branchName: currentBranchName,
            worktreePath: branches.find((branch) => branch.name === currentBranchName)?.worktree?.path ?? null,
          })]: options.preferredWorkspacePaneTab,
        }
      : undefined)
  const repo = seedRepoShellForTest({
    id: options.id,
    name: options.name,
    repoRuntimeId: options.repoRuntimeId,
    currentBranchName,
    ...(preferredWorkspacePaneTabByTarget ? { preferredWorkspacePaneTabByTarget } : {}),
    remote: options.remote,
  })
  seedRepoReadModelQueryData(repo, {
    branches: branchesWithSnapshotWorktreeMetadata,
    currentBranch: options.currentBranch ?? currentBranchName ?? '',
    status,
  })
  for (const [branchName, tabs] of Object.entries(options.workspacePaneTabsByBranch ?? {})) {
    const branch = branches.find((candidate) => candidate.name === branchName)
    if (!branch) continue
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: options.id,
      repoRuntimeId: repo.repoRuntimeId,
      branchName,
      worktreePath: branch.worktree?.path ?? null,
      tabs,
    })
  }
  return repo
}

export function seedRepoReadModelQueryData(
  repo: Pick<RepoState, 'id' | 'repoRuntimeId'>,
  readModel: {
    branches: BranchSnapshotInfo[]
    currentBranch: string
    status?: WorktreeStatus[]
  },
): void {
  const projection: RepoRuntimeProjection = {
    snapshot: {
      branches: readModel.branches,
      current: readModel.currentBranch,
    },
    status: readModel.status ?? [],
    pullRequests: null,
    operations: { operations: [], loadedAt: 0 },
    requested: {
      branch: null,
      pullRequestMode: 'full',
    },
    loadedAt: 0,
  }
  setRepoProjectionQueryData(repo.id, repo.repoRuntimeId, null, 'full', projection)
  if (readModel.currentBranch) {
    setRepoProjectionQueryData(repo.id, repo.repoRuntimeId, readModel.currentBranch, 'full', {
      ...projection,
      requested: {
        branch: readModel.currentBranch,
        pullRequestMode: 'full',
      },
    })
  }
}
