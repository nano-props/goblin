// Web IPC bridge helpers used by tests that need to simulate the
// Goblin client's interaction with the embedded server. They live
// here so non-repo tests (e.g. workspace, settings, branch actions)
// can depend on the same IPC + bridge plumbing without pulling in
// the repo store.
//
// Design choices:
//   - `handlers` is a `Record<string, IpcTestHandler>` keyed by IPC
//     pathname (`'workspace.probe'`, `'repo.projection'`, etc.) and server
//     route. `installGoblinTestBridge`
//     wires each pathname to the matching fetch URL.
//   - The bridge mock composes the same `goblinNative` shape the real
//     client bridge exposes, including `host`, `terminal`, `invokeIpc`,
//     and `onEvent`.
//   - `seedRepoShellForTest`, `seedRepoWithReadModelForTest`, and
//     `resetWorkspacesStore` interact with the live `useWorkspacesStore`
//     (Zustand) — they do not mock the store; they drive it. Tests
//     that need a fresh store call `resetWorkspacesStore` in `beforeEach`.

import type {
  GitRemoteProjection,
  GitWorkspaceProjection,
  WorkspaceState,
  RepoBranchState,
} from '#/web/stores/workspaces/types.ts'
import { readRepoBranchQueryProjection, type RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'
import { stripBranchWorktreeMetadata } from '#/web/stores/workspaces/worktree-state.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { disposeAllRepoOperationSchedulers } from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import type { ClientBridge } from '#/web/client-bridge-types.ts'
import type { GitWorkspaceRuntimeProjection } from '#/shared/api-types.ts'
import type { RemoteWorkspaceConnectionLifecycle, RemoteWorkspaceRuntimeLifecycle } from '#/shared/remote-workspace.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { resetAcceptedRepoProjectionReadModelState } from '#/web/stores/workspaces/projection-read-model-effects.ts'
import { setRepoProjectionQueryData, setRepoWorktreeStatusQueryData } from '#/web/repo-query-cache.ts'
import {
  readWorkspacePaneTabsForTarget,
  writeWorkspacePaneTabsSnapshotQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import {
  workspacePaneTabsWithStaticTab,
  workspacePaneTabsWithoutStaticTab,
} from '#/web/workspace-pane/workspace-pane-tabs.ts'
import {
  runtimeWorkspacePaneTarget,
  requiredGitWorkspacePaneTabsTarget,
  workspacePaneTabsTargetFromRuntime,
  workspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import { workspacePaneTabEntryIdentity, workspacePaneTabsWithRuntimeTab } from '#/shared/workspace-pane.ts'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { DEFAULT_ZEN_MODE, DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
import type { WorkspaceProbeState, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'
import type {
  TerminalAttachResult,
  TerminalRestartResult,
  TerminalMutationResult,
  TerminalWriteResult,
  TerminalSessionsSnapshot,
  TerminalTakeoverResult,
} from '#/shared/terminal-types.ts'
import { terminalGitWorktreePresentation } from '#/shared/terminal-types.ts'
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
export type RepoPresentationForTest = WorkspaceState & {
  operations: GitWorkspaceProjection['operations']
  remote: GitRemoteProjection
  remoteLifecycle: Extract<WorkspaceState['admission'], { kind: 'remote' }>['lifecycle']
  ui: WorkspaceState['ui'] & GitWorkspaceProjection['ui']
  branchAction: GitWorkspaceProjection['operations']['branchAction']
  branchModel: RepoBranchReadModelData
}

export function repoPresentationForTest(
  repo: WorkspaceState,
  branchReadModel: RepoBranchReadModelData,
): RepoPresentationForTest {
  if (repo.capability.kind !== 'git') throw new Error(`test repo is not Git-capable: ${repo.id}`)
  const git = repo.capability.git
  return {
    ...repo,
    operations: git.operations,
    remote: git.remote,
    remoteLifecycle: repo.admission.kind === 'remote' ? repo.admission.lifecycle : null,
    ui: { ...repo.ui, ...git.ui },
    branchAction: git.operations.branchAction,
    branchModel: branchReadModel,
  }
}

export function createGitRepoPresentationForTest(
  repo: WorkspaceState,
  branchReadModel: RepoBranchReadModelData,
): RepoPresentationForTest {
  acceptWorkspaceProbeState(repo, createGitWorkspaceProbeForTest(repo.name))
  return repoPresentationForTest(repo, branchReadModel)
}

export function repoPresentationFromQueryForTest(repo: WorkspaceState): RepoPresentationForTest {
  if (repo.capability.kind !== 'git') throw new Error(`test repo is not Git-capable: ${repo.id}`)
  const git = repo.capability.git
  const readModel = readRepoBranchQueryProjection(repo)
  if (!readModel) throw new Error(`missing branch read model for test repo: ${repo.id}`)
  return {
    ...repo,
    operations: git.operations,
    remote: git.remote,
    remoteLifecycle: repo.admission.kind === 'remote' ? repo.admission.lifecycle : null,
    ui: { ...repo.ui, ...git.ui },
    branchAction: git.operations.branchAction,
    branchModel: readModel,
  }
}

export function seedRepoShellForTest(options: {
  id: string
  name?: string
  currentBranchName?: string | null
  preferredWorkspacePaneTabByTarget?: Record<string, WorkspacePaneTabType | null>
  workspaceRuntimeId?: string
  remote?: Partial<GitRemoteProjection>
  remoteLifecycle?: RemoteWorkspaceConnectionLifecycle | null
  workspaceProbe?: WorkspaceProbeState
}): WorkspaceState {
  const workspaceId = workspaceIdForTest(options.id)
  const base = emptyWorkspace(
    workspaceId,
    options.name ?? 'repo',
    options.workspaceRuntimeId ?? createOpaqueId('repo-runtime'),
  )
  const repo: WorkspaceState = {
    ...base,
    ui: {
      ...base.ui,
      preferredWorkspacePaneTabByTarget:
        options.preferredWorkspacePaneTabByTarget ?? base.ui.preferredWorkspacePaneTabByTarget,
    },
  }
  acceptWorkspaceProbeState(repo, options.workspaceProbe ?? base.capability.probe)
  if (repo.capability.kind === 'git' && options.remote) {
    repo.capability.git.remote = { ...repo.capability.git.remote, ...options.remote }
  }
  if (options.remoteLifecycle !== undefined && repo.admission.kind === 'remote') {
    repo.admission.lifecycle = options.remoteLifecycle
  }
  useWorkspacesStore.setState({
    workspaces: { [workspaceId]: repo },
    repoSnapshotCache: {},
    workspaceOrder: [workspaceId],
    restoredWorkspaceId: workspaceId,
    workspaceMembershipReady: true,
    sessionPersistenceReady: true,
    sessionRestoreError: null,
    restoredClientWorkspaceBaseline: null,
    zenMode: DEFAULT_ZEN_MODE,
    workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
  })
  return repo
}

export function setWorkspaceProbeForTest(workspaceId: string, workspaceProbe: WorkspaceProbeState): void {
  useWorkspacesStore.setState((state) => {
    const workspace = state.workspaces[workspaceId]
    if (!workspace) throw new Error(`Missing workspace fixture: ${workspaceId}`)
    const next = { ...workspace }
    acceptWorkspaceProbeState(next, workspaceProbe)
    return { workspaces: { ...state.workspaces, [workspaceId]: next } }
  })
}

interface TerminalClientTestOutputs {
  'terminal.attach': TerminalAttachResult
  'terminal.restart': TerminalRestartResult
  'terminal.write': TerminalWriteResult
  'terminal.resize': TerminalMutationResult
  'terminal.takeover': TerminalTakeoverResult
  'terminal.close': TerminalMutationResult
  'terminal.prune': { pruned: number; remaining: number }
  'terminal.recoverSessions': TerminalSessionsSnapshot
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

export function createGitWorkspaceProbeForTest(name = 'workspace'): WorkspaceProbeState {
  return {
    status: 'ready',
    name,
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
    },
    diagnostics: [],
  }
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

type TestWorkspacePaneRuntimeTabInput =
  | (WorkspacePaneTabsTarget & { workspaceRuntimeId: string; terminalSessionId: string })
  | {
      workspaceId: string
      workspaceRuntimeId: string
      branchName: string
      worktreePath: string
      terminalSessionId: string
    }

function testWorkspacePaneRuntimeTabTarget(
  input: TestWorkspacePaneRuntimeTabInput,
): WorkspacePaneTabsTarget & { workspaceRuntimeId: string } {
  return 'kind' in input
    ? input
    : {
        ...requiredGitWorkspacePaneTabsTarget(
          workspaceIdForTest(input.workspaceId),
          input.branchName,
          input.worktreePath,
        ),
        workspaceRuntimeId: input.workspaceRuntimeId,
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
): {
  addRuntimeTab: (
    input: TestWorkspacePaneRuntimeTabInput & {
      insertAfterIdentity?: string | null
    },
  ) => void
  removeRuntimeTab: (input: TestWorkspacePaneRuntimeTabInput) => void
} {
  let serverEntries: WorkspacePaneTabsEntry[] = []
  let serverRevision = 0
  const targetKey = (input: WorkspacePaneTabsTarget) => workspacePaneTabsTargetIdentityKey(input)
  const entryTarget = (entry: WorkspacePaneTabsEntry) => workspacePaneTabsTargetFromRuntime(entry.target)
  const serverTabsForTarget = (
    input: WorkspacePaneTabsTarget & { workspaceRuntimeId: string },
  ): WorkspacePaneTabEntry[] => {
    const entry = serverEntries.find((candidate) => {
      const target = entryTarget(candidate)
      return target && targetKey(target) === targetKey(input)
    })
    if (entry) return [...entry.tabs]
    const tabs = readWorkspacePaneTabsForTarget(input)
    const key = targetKey(input)
    serverEntries = [
      ...serverEntries.filter((candidate) => {
        const target = entryTarget(candidate)
        return !target || targetKey(target) !== key
      }),
      { target: runtimeWorkspacePaneTarget(input, input.workspaceRuntimeId)!, tabs },
    ]
    return tabs
  }
  const replaceServerTarget = (
    input: WorkspacePaneTabsTarget & { workspaceRuntimeId: string },
    tabs: readonly WorkspacePaneTabEntry[],
  ): WorkspacePaneTabEntry[] => {
    const nextTabs = [...tabs]
    const key = targetKey(input)
    serverEntries = [
      ...serverEntries.filter((entry) => {
        const target = entryTarget(entry)
        return !target || targetKey(target) !== key
      }),
      { target: runtimeWorkspacePaneTarget(input, input.workspaceRuntimeId)!, tabs: nextTabs },
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
        terminalProjectionEffect: { kind: 'delta', revision: 1 },
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
      recoverSessions: async () => ({ revision: 0, sessions: [] }),
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
        const target = workspacePaneTabsTargetFromRuntime(input.target)
        if (!target) return serverSnapshot()
        replaceServerTarget({ ...target, workspaceRuntimeId: input.workspaceRuntimeId }, tabs)
        return commitServerSnapshot()
      },
      update: async (input) => {
        const target = workspacePaneTabsTargetFromRuntime(input.target)
        if (!target) return serverSnapshot()
        const legacyInput = { ...target, workspaceRuntimeId: input.workspaceRuntimeId }
        if (options.updateWorkspaceTabs) serverTabsForTarget(legacyInput)
        const tabs = options.updateWorkspaceTabs
          ? await options.updateWorkspaceTabs(input)
          : defaultWorkspacePaneTabsOperationResult(input, serverTabsForTarget(legacyInput))
        replaceServerTarget(legacyInput, tabs)
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
          entries: serverEntries.filter((entry) => entry.target.workspaceId === input.workspaceId),
        }
      },
      onChanged: () => () => {},
    }),
    workspacePaneRuntime: () => ({
      open: async (input) => {
        const terminalSessionId = 'term-testtesttesttesttest1'
        const terminalRuntimeSessionId = 'pty_test_aaaaaaaaa'
        const projectedTarget = workspacePaneTabsTargetFromRuntime(input.request.target)
        if (!projectedTarget) throw new Error('invalid terminal runtime target')
        const target = { ...projectedTarget, workspaceRuntimeId: input.request.target.workspaceRuntimeId }
        replaceServerTarget(
          target,
          workspacePaneTabsWithRuntimeTab(serverTabsForTarget(target), 'terminal', terminalSessionId, {
            insertAfterIdentity: input.insertAfterIdentity,
          }),
        )
        const paneTabsSnapshot = commitServerSnapshot()
        return {
          ok: true,
          runtimeType: 'terminal',
          paneTabsSnapshot,
          runtime: {
            ok: true,
            action: 'created',
            presentation:
              input.request.target.kind === 'workspace-root'
                ? { kind: 'workspace-root' as const }
                : terminalGitWorktreePresentation('main'),
            terminalSessionId,
            terminalProjectionEffect: { kind: 'delta', revision: 1 },
            terminalRuntimeSessionId,
            terminalRuntimeGeneration: 1,
            processName: 'zsh',
            canonicalTitle: null,
            phase: 'open',
            message: null,
            controller: { clientId: input.request.clientId ?? 'attachment_local', status: 'connected' },
            canonicalCols: input.request.cols ?? 80,
            canonicalRows: input.request.rows ?? 24,
          },
        } as const
      },
      close: async (input) => {
        const projectedTarget = workspacePaneTabsTargetFromRuntime(input.target.target)
        if (!projectedTarget) throw new Error('invalid terminal runtime target')
        const target = { ...projectedTarget, workspaceRuntimeId: input.target.target.workspaceRuntimeId }
        const currentTabs = serverTabsForTarget(target)
        const wasOpen = currentTabs.some(
          (tab) => tab.type === input.runtimeType && tab.runtimeSessionId === input.sessionId,
        )
        replaceServerTarget(
          target,
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
        }
      },
    }),
  } satisfies ClientBridge)
  return {
    addRuntimeTab: (input) => {
      const target = testWorkspacePaneRuntimeTabTarget(input)
      replaceServerTarget(
        target,
        workspacePaneTabsWithRuntimeTab(serverTabsForTarget(target), 'terminal', input.terminalSessionId, {
          insertAfterIdentity: input.insertAfterIdentity,
        }),
      )
      const snapshot = commitServerSnapshot()
      writeWorkspacePaneTabsSnapshotQueryData(target.workspaceId, input.workspaceRuntimeId, snapshot)
    },
    removeRuntimeTab: (input) => {
      const target = testWorkspacePaneRuntimeTabTarget(input)
      replaceServerTarget(
        target,
        serverTabsForTarget(target).filter(
          (tab) => tab.type !== 'terminal' || tab.runtimeSessionId !== input.terminalSessionId,
        ),
      )
      commitServerSnapshot()
    },
  }
}

function defaultWorkspacePaneTabsOperationResult(
  input: Pick<WorkspacePaneTabsUpdateInput, 'operation'>,
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
  const input = value as { workspaceId?: unknown; workspaceRuntimeId?: unknown; target?: unknown; operation?: unknown }
  return (
    typeof input.workspaceId === 'string' &&
    typeof input.workspaceRuntimeId === 'string' &&
    Boolean(input.target) &&
    !!input.operation &&
    typeof input.operation === 'object'
  )
}

function isWorkspacePaneTabsReplaceInput(value: unknown): value is WorkspacePaneTabsReplaceInput {
  if (!value || typeof value !== 'object') return false
  const input = value as {
    workspaceId?: unknown
    workspaceRuntimeId?: unknown
    target?: unknown
    tabs?: unknown
  }
  return (
    typeof input.workspaceId === 'string' &&
    typeof input.workspaceRuntimeId === 'string' &&
    Boolean(input.target) &&
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

export function resetWorkspacesStore(): void {
  disposeAllRepoOperationSchedulers()
  resetAcceptedRepoProjectionReadModelState()
  primaryWindowQueryClient.clear()
  useWorkspacesStore.setState({
    workspaces: {},
    repoSnapshotCache: {},
    workspaceOrder: [],
    restoredWorkspaceId: null,
    workspaceMembershipReady: false,
    sessionPersistenceReady: false,
    sessionRestoreError: null,
    restoredClientWorkspaceBaseline: null,
    zenMode: DEFAULT_ZEN_MODE,
    workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
    selectedTerminalSessionIdByTerminalFilesystemTarget: {},
    tabOpenerIdentityByScope: {},
    navigationHistoryByWorkspace: {},
  })
}

export function installGoblinTestBridge(handlers: Record<string, IpcTestHandler>): void {
  const workspaceRuntimeState = new Map<
    string,
    {
      currentWorkspaceRuntimeId: string | null
      members: Set<string>
      workspaceProbe?: WorkspaceProbeState
      remoteLifecycle?: RemoteWorkspaceRuntimeLifecycle
    }
  >()
  const sessionStorageValues = new Map<string, string>()
  const hostOpenExternalUrl = handlers['app.openExternalUrl']
  const hostOpenDirectoryDialog = handlers['workspace.openDialog']
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
          recoverSessions: () => Promise.resolve({ revision: 0, sessions: [] }),
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
                    target: payload.target,
                    tabs: [...payload.tabs],
                  },
                ]
              : [],
          }
        case 'workspacePaneTabs.update': {
          const input = isWorkspacePaneTabsUpdateInput(payload) ? payload : null
          const target = input ? workspacePaneTabsTargetFromRuntime(input.target) : null
          return {
            revision: 1,
            entries:
              input && target
                ? [
                    {
                      target: input.target,
                      tabs: defaultWorkspacePaneTabsOperationResult(
                        input,
                        readWorkspacePaneTabsForTarget({ ...target, workspaceRuntimeId: input.workspaceRuntimeId }),
                      ),
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
          }
        }
        case 'terminal.recoverSessions':
          return { revision: 0, sessions: [] }
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
      pruneTerminals: async (workspaceId, workspaceRuntimeId) =>
        callTerminalHandler('terminal.prune', { workspaceId, workspaceRuntimeId }),
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
            requested?: unknown
            lastFetchAt?: unknown
            loadedAt?: unknown
          }
          return {
            snapshot: projection.snapshot ?? null,
            pullRequests: projection.pullRequests ?? null,
            requested:
              projection.requested && typeof projection.requested === 'object'
                ? projection.requested
                : {
                    branch,
                    pullRequestMode: mode,
                  },
            lastFetchAt: typeof projection.lastFetchAt === 'number' ? projection.lastFetchAt : null,
            loadedAt: typeof projection.loadedAt === 'number' ? projection.loadedAt : Date.now(),
          }
        }
        return normalizeProjection(await call('repo.projection', payload))
      }
      const openWorkspaceRuntime = async (payload: unknown) => {
        const workspaceId =
          typeof payload === 'object' && payload && 'workspaceId' in payload ? payload.workspaceId : null
        const workspaceInput =
          typeof payload === 'object' && payload && 'workspaceInput' in payload ? payload.workspaceInput : null
        const clientId = typeof payload === 'object' && payload && 'clientId' in payload ? payload.clientId : null
        if (typeof clientId !== 'string' || clientId.length === 0) throw new Error('runtime-open requires clientId')
        if (typeof workspaceInput === 'string' && workspaceInput.length > 0) {
          const probe = (await call('workspace.probe', { workspaceInput })) as WorkspaceSettledProbeState
          if (probe.status === 'unavailable') {
            return {
              ok: false as const,
              input: workspaceInput,
              reason: probe.reason,
            }
          }
          const state = workspaceRuntimeState.get(workspaceInput) ?? {
            currentWorkspaceRuntimeId: null,
            members: new Set<string>(),
          }
          if (!state.currentWorkspaceRuntimeId) state.currentWorkspaceRuntimeId = createOpaqueId('workspace-runtime')
          state.members.add(clientId)
          state.workspaceProbe = {
            status: 'ready',
            name: probe.name,
            capabilities: probe.capabilities,
            diagnostics: probe.diagnostics,
          }
          workspaceRuntimeState.set(workspaceInput, state)
          return {
            ok: true as const,
            workspace: { id: workspaceInput, name: probe.name },
            workspaceRuntimeId: state.currentWorkspaceRuntimeId,
            capabilities: probe.capabilities,
            diagnostics: probe.diagnostics,
          }
        }
        if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
          throw new Error('runtime-open requires workspaceId')
        }
        const state = workspaceRuntimeState.get(workspaceId) ?? {
          currentWorkspaceRuntimeId: null,
          members: new Set<string>(),
        }
        const workspaceRuntimeId = state.currentWorkspaceRuntimeId ?? createOpaqueId('workspace-runtime')
        state.currentWorkspaceRuntimeId = workspaceRuntimeId
        state.members.add(clientId)
        workspaceRuntimeState.set(workspaceId, state)
        return { ok: true as const, workspaceRuntimeId }
      }
      const closeWorkspaceRuntime = (payload: unknown) => {
        const workspaceId =
          typeof payload === 'object' && payload && 'workspaceId' in payload ? payload.workspaceId : null
        const workspaceRuntimeId =
          typeof payload === 'object' && payload && 'workspaceRuntimeId' in payload ? payload.workspaceRuntimeId : null
        const clientId = typeof payload === 'object' && payload && 'clientId' in payload ? payload.clientId : null
        if (typeof workspaceId !== 'string' || typeof workspaceRuntimeId !== 'string' || typeof clientId !== 'string') {
          throw new Error('runtime-close requires workspaceId, workspaceRuntimeId, and clientId')
        }
        const state = workspaceRuntimeState.get(workspaceId)
        const released =
          !!state && state.currentWorkspaceRuntimeId === workspaceRuntimeId && state.members.delete(clientId)
        const runtimeClosed = released && !!state && state.members.size === 0
        if (runtimeClosed) state.currentWorkspaceRuntimeId = null
        return { ok: true as const, released, runtimeClosed }
      }
      const reconcileWorkspaceRuntimeMemberships = (payload: unknown) => {
        const clientId = typeof payload === 'object' && payload && 'clientId' in payload ? payload.clientId : null
        const workspaceIds =
          typeof payload === 'object' && payload && 'workspaceIds' in payload ? payload.workspaceIds : null
        if (
          typeof clientId !== 'string' ||
          !Array.isArray(workspaceIds) ||
          !workspaceIds.every((workspaceId) => typeof workspaceId === 'string')
        ) {
          throw new Error('runtime-reconcile requires clientId and workspaceIds')
        }
        const desired = new Set(workspaceIds)
        for (const [workspaceId, state] of workspaceRuntimeState) {
          if (desired.has(workspaceId)) continue
          state.members.delete(clientId)
          if (state.members.size === 0) state.currentWorkspaceRuntimeId = null
        }
        return {
          runtimes: workspaceIds.map((workspaceId) => {
            const state = workspaceRuntimeState.get(workspaceId) ?? {
              currentWorkspaceRuntimeId: null,
              members: new Set<string>(),
            }
            state.currentWorkspaceRuntimeId ??= createOpaqueId('workspace-runtime')
            state.members.add(clientId)
            workspaceRuntimeState.set(workspaceId, state)
            return {
              workspaceId,
              workspaceRuntimeId: state.currentWorkspaceRuntimeId,
              workspaceProbe: state.workspaceProbe ?? { status: 'probing' },
              ...(state.remoteLifecycle ? { remoteLifecycle: state.remoteLifecycle } : {}),
            }
          }),
        }
      }
      const listWorkspaceRuntimes = () => ({
        runtimes: Array.from(workspaceRuntimeState.entries()).flatMap(([workspaceId, state]) =>
          state.currentWorkspaceRuntimeId
            ? [
                {
                  workspaceId,
                  workspaceRuntimeId: state.currentWorkspaceRuntimeId,
                  workspaceProbe: state.workspaceProbe ?? { status: 'probing' },
                  ...(state.remoteLifecycle ? { remoteLifecycle: state.remoteLifecycle } : {}),
                },
              ]
            : [],
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
        if (url.pathname === '/api/settings/recent-workspaces/add') return call('settings.addRecentWorkspace', body)
        if (url.pathname === '/api/settings/workspace/restore') return call('settings.restoreWorkspace', body)
        if (url.pathname === '/api/settings/workspace/entries/add') return call('settings.addWorkspaceEntry', body)
        if (url.pathname === '/api/settings/workspace/entries/remove')
          return call('settings.removeWorkspaceEntry', body)
        if (url.pathname === '/api/settings/fetch-interval') return call('settings.setFetchInterval', body)
        if (url.pathname === '/api/settings/prefs') return call('settings.updateUserSettings', body)
        if (url.pathname === '/api/remote/ssh-hosts') return call('remote.listSshHosts', undefined)
        if (url.pathname === '/api/remote/resolve-target') return call('remote.resolveTarget', body)
        if (url.pathname === '/api/remote/lifecycle') {
          return Promise.resolve(call('remote.lifecycle', body)).then((result) => {
            const value = result as {
              kind?: string
              workspaceId?: string
              name?: string
              lifecycle?: RemoteWorkspaceRuntimeLifecycle
            }
            if (value.kind === 'settled' && value.workspaceId && value.lifecycle) {
              const requestedRuntimeId =
                typeof body.workspaceRuntimeId === 'string' ? body.workspaceRuntimeId : createOpaqueId('repo-runtime')
              const state = workspaceRuntimeState.get(value.workspaceId) ?? {
                currentWorkspaceRuntimeId: requestedRuntimeId,
                members: new Set<string>(),
              }
              workspaceRuntimeState.set(value.workspaceId, state)
              if (state.currentWorkspaceRuntimeId === requestedRuntimeId) {
                state.remoteLifecycle = value.lifecycle
                if (value.lifecycle.kind === 'ready') {
                  state.workspaceProbe = {
                    status: 'ready',
                    name: value.name ?? value.workspaceId,
                    capabilities: {
                      files: { read: true, write: true },
                      terminal: { available: true },
                      git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
                    },
                    diagnostics: [],
                  }
                }
              }
            }
            return result
          })
        }
        if (url.pathname === '/api/remote/path-suggestions') return call('remote.listPathSuggestions', body)
        if (url.pathname === '/api/remote/test-workspace') return call('remote.testWorkspace', body)
        if (url.pathname === '/api/repo/log') return call('repo.log', body)
        if (url.pathname === '/api/repo/remote-branches') return call('repo.remoteBranches', body)
        if (url.pathname === '/api/repo/projection') return readRepoProjection(body)
        if (url.pathname === '/api/repo/worktree-status') {
          return handlers['repo.worktreeStatus']
            ? call('repo.worktreeStatus', body)
            : { workspaceRuntimeId: body.workspaceRuntimeId, status: [], loadedAt: Date.now() }
        }
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
        if (url.pathname === '/api/repo/background-sync-repos') return call('repo.backgroundSyncRepos', body)
        if (url.pathname === '/api/workspace/runtime-open') {
          return handlers['workspace.runtimeOpen'] ? call('workspace.runtimeOpen', body) : openWorkspaceRuntime(body)
        }
        if (url.pathname === '/api/workspace/tree') return call('workspace.tree', body)
        if (url.pathname === '/api/workspace/trash-file') return call('workspace.trashFile', body)
        if (url.pathname === '/api/workspace/file-viewer') return call('workspace.fileViewer', body)
        if (url.pathname === '/api/workspace/open-terminal') return call('workspace.openTerminal', body)
        if (url.pathname === '/api/workspace/open-editor') return call('workspace.openEditor', body)
        if (url.pathname === '/api/workspace/open-in-finder') return call('workspace.openInFinder', body)
        if (url.pathname === '/api/workspace/runtime-list') {
          return handlers['workspace.runtimeList'] ? call('workspace.runtimeList', body) : listWorkspaceRuntimes()
        }
        if (url.pathname === '/api/workspace/runtime-reconcile') {
          return handlers['workspace.runtimeReconcile']
            ? call('workspace.runtimeReconcile', body)
            : reconcileWorkspaceRuntimeMemberships(body)
        }
        if (url.pathname === '/api/workspace/runtime-close') {
          return handlers['workspace.runtimeClose'] ? call('workspace.runtimeClose', body) : closeWorkspaceRuntime(body)
        }
        if (url.pathname === '/api/workspace/refresh') {
          return handlers['workspace.refresh']
            ? call('workspace.refresh', body)
            : {
                kind: 'committed',
                probe: {
                  status: 'ready',
                  name: 'workspace',
                  capabilities: {
                    files: { read: true, write: true },
                    terminal: { available: true },
                    git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
                  },
                  diagnostics: [],
                },
              }
        }
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
  workspaceRuntimeId?: string
  status?: WorktreeStatus[]
  remote?: Partial<GitRemoteProjection>
  remoteLifecycle?: RemoteWorkspaceConnectionLifecycle | null
  workspaceProbe?: WorkspaceProbeState
}): WorkspaceState {
  const workspaceId = workspaceIdForTest(options.id)
  const branchesWithSnapshotWorktreeMetadata = options.branchSnapshots ?? options.branches ?? []
  const branches = options.branches ?? stripBranchWorktreeMetadata(branchesWithSnapshotWorktreeMetadata)
  const status = options.status ?? []
  const currentBranchName = options.currentBranchName ?? null
  const preferredWorkspacePaneTabByTarget =
    options.preferredWorkspacePaneTabByTarget ??
    (currentBranchName && options.preferredWorkspacePaneTab !== undefined
      ? {
          [workspacePaneTabsTargetIdentityKey(
            requiredGitWorkspacePaneTabsTarget(
              workspaceId,
              currentBranchName,
              branchesWithSnapshotWorktreeMetadata.find((branch) => branch.name === currentBranchName)?.worktree
                ?.path ?? null,
            ),
          )]: options.preferredWorkspacePaneTab,
        }
      : undefined)
  const repo = seedRepoShellForTest({
    id: options.id,
    name: options.name,
    workspaceRuntimeId: options.workspaceRuntimeId,
    currentBranchName,
    ...(preferredWorkspacePaneTabByTarget ? { preferredWorkspacePaneTabByTarget } : {}),
    remote: options.remote,
    remoteLifecycle: options.remoteLifecycle,
    workspaceProbe: options.workspaceProbe ?? {
      status: 'ready',
      name: options.name ?? 'repo',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
      diagnostics: [],
    },
  })
  seedRepoReadModelQueryData(repo, {
    branches: branchesWithSnapshotWorktreeMetadata,
    currentBranch: options.currentBranch ?? currentBranchName ?? '',
    status,
  })
  for (const [branchName, tabs] of Object.entries(options.workspacePaneTabsByBranch ?? {})) {
    const branch = branchesWithSnapshotWorktreeMetadata.find((candidate) => candidate.name === branchName)
    if (!branch) continue
    setWorkspacePaneTabsForTargetQueryData({
      ...requiredGitWorkspacePaneTabsTarget(repo.id, branchName, branch.worktree?.path ?? null),
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs,
    })
  }
  return repo
}

export function seedRepoReadModelQueryData(
  repo: Pick<WorkspaceState, 'id' | 'workspaceRuntimeId'>,
  readModel: {
    branches: BranchSnapshotInfo[]
    currentBranch: string
    status?: WorktreeStatus[]
  },
): void {
  const projection: GitWorkspaceRuntimeProjection = {
    snapshot: {
      branches: readModel.branches,
      current: readModel.currentBranch,
    },
    pullRequests: null,
    requested: {
      branch: null,
      pullRequestMode: 'full',
    },
    lastFetchAt: null,
    loadedAt: 0,
  }
  setRepoProjectionQueryData(repo.id, repo.workspaceRuntimeId, null, 'full', projection)
  setRepoWorktreeStatusQueryData(repo.id, repo.workspaceRuntimeId, {
    workspaceRuntimeId: repo.workspaceRuntimeId,
    status: readModel.status ?? [],
    loadedAt: 0,
  })
  if (readModel.currentBranch) {
    setRepoProjectionQueryData(repo.id, repo.workspaceRuntimeId, readModel.currentBranch, 'full', {
      ...projection,
      requested: {
        branch: readModel.currentBranch,
        pullRequestMode: 'full',
      },
    })
  }
}
