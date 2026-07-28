// Workspace-pane tab bridge and canonical tab-operation behavior for web tests.

import { CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { terminalGitWorktreePresentation } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsWithRuntimeTab } from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneTabsEntry,
  WorkspacePaneTabsReplaceInput,
  WorkspacePaneTabsSnapshot,
  WorkspacePaneTabsUpdateInput,
} from '#/shared/workspace-pane-tabs.ts'
import { workspacePaneTabsWithUpdateOperation } from '#/shared/workspace-pane-tabs-operations.ts'
import {
  requiredGitWorkspacePaneTabsTarget,
  runtimeWorkspacePaneTarget,
  workspacePaneTabsTargetFromRuntime,
  workspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import type { ClientBridge } from '#/web/client-bridge-types.ts'
import {
  readWorkspacePaneTabsForTarget,
  writeWorkspacePaneTabsSnapshotQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

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
      resize: async (input) => ({
        ok: true,
        terminalRuntimeSessionId: input.terminalRuntimeSessionId,
        terminalRuntimeGeneration: input.terminalRuntimeGeneration,
        identityRevision: 1,
        role: 'controller',
        controllerStatus: 'connected',
        controller: { clientId: 'attachment_local', status: 'connected' },
        canonicalSize: { cols: input.cols, rows: input.rows },
      }),
      takeover: async () => ({
        ok: true as const,
        terminalRuntimeSessionId: 'pty_test_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        identityRevision: 1,
        role: 'controller' as const,
        controllerStatus: 'connected' as const,
        controller: { clientId: 'attachment_local', status: 'connected' as const },
        canonicalSize: { cols: 80, rows: 24 },
        phase: 'open' as const,
      }),
      close: async () => true,
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
          : workspacePaneTabsWithUpdateOperation(serverTabsForTarget(legacyInput), input.operation)
        replaceServerTarget(legacyInput, tabs)
        return commitServerSnapshot()
      },
      list: async (input) => {
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
            terminalRuntimeGeneration: 0,
            identityRevision: 0,
            processName: '',
            canonicalTitle: null,
            phase: 'opening',
            message: null,
            controller: null,
            canonicalSize: null,
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
        const paneTabsSnapshot = commitServerSnapshot()
        return {
          ok: true,
          runtimeType: input.runtimeType,
          paneTabsSnapshot,
          runtime: wasOpen
            ? {
                action: 'closed' as const,
                terminalSessionId: input.sessionId,
                terminalRuntimeSessionId: 'pty_test_aaaaaaaaa',
                terminalRuntimeGeneration: 1,
              }
            : { action: 'already-closed' as const, terminalSessionId: input.sessionId },
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
