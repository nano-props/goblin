import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const mocks = vi.hoisted(() => ({
  resolveWorkspaceFilesystemExecution: vi.fn(),
  openInPreferredEditor: vi.fn(),
  openRemoteInPreferredEditor: vi.fn(),
  openInPreferredTerminal: vi.fn(),
  openRemoteInPreferredTerminal: vi.fn(),
  openInFinder: vi.fn(),
}))

vi.mock('#/server/modules/workspace-filesystem-execution.ts', () => ({
  resolveWorkspaceFilesystemExecution: mocks.resolveWorkspaceFilesystemExecution,
}))
vi.mock('#/system/editors.ts', () => ({
  openInPreferredEditor: mocks.openInPreferredEditor,
  openRemoteInPreferredEditor: mocks.openRemoteInPreferredEditor,
}))
vi.mock('#/system/terminals.ts', () => ({
  openInPreferredTerminal: mocks.openInPreferredTerminal,
  openRemoteInPreferredTerminal: mocks.openRemoteInPreferredTerminal,
}))
vi.mock('#/system/finder.ts', () => ({ openInFinder: mocks.openInFinder }))

import {
  openWorkspaceEditor,
  openWorkspaceInFinder,
  openWorkspaceTerminal,
} from '#/server/modules/workspace-external-apps.ts'

const LOCAL_WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/workspace')
const REMOTE_WORKSPACE_ID = workspaceIdForTest('goblin+ssh://example.test/workspace')
const LOCAL_TARGET = {
  kind: 'workspace-root' as const,
  workspaceId: LOCAL_WORKSPACE_ID,
  workspaceRuntimeId: 'workspace-runtime-local-test',
}
const REMOTE_TARGET = {
  kind: 'workspace-root' as const,
  workspaceId: REMOTE_WORKSPACE_ID,
  workspaceRuntimeId: 'workspace-runtime-remote-test',
}

describe('workspace external apps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openInPreferredTerminal.mockResolvedValue({ ok: true, message: '' })
    mocks.openInPreferredEditor.mockResolvedValue({ ok: true, message: '' })
    mocks.openRemoteInPreferredTerminal.mockResolvedValue({ ok: true, message: '' })
    mocks.openRemoteInPreferredEditor.mockResolvedValue({ ok: true, message: '' })
    mocks.openInFinder.mockResolvedValue({ ok: true, message: '' })
  })

  test('opens local targets through native local applications', async () => {
    mocks.resolveWorkspaceFilesystemExecution.mockResolvedValue({
      transport: 'local',
      target: LOCAL_TARGET,
      executionPath: '/tmp/workspace',
      worktree: null,
    })

    await openWorkspaceTerminal(LOCAL_TARGET, 'ghostty')
    await openWorkspaceEditor(LOCAL_TARGET, 'vscode')
    await openWorkspaceInFinder(LOCAL_TARGET)

    expect(mocks.openInPreferredTerminal).toHaveBeenCalledWith('/tmp/workspace', 'ghostty')
    expect(mocks.openInPreferredEditor).toHaveBeenCalledWith('/tmp/workspace', 'vscode')
    expect(mocks.openInFinder).toHaveBeenCalledWith('/tmp/workspace')
  })

  test('opens remote targets through the resolved SSH alias', async () => {
    mocks.resolveWorkspaceFilesystemExecution.mockResolvedValue({
      transport: 'remote',
      target: REMOTE_TARGET,
      executionPath: '/workspace',
      remoteTarget: { alias: 'example' },
      run: vi.fn(),
      worktree: null,
    })

    await openWorkspaceTerminal(REMOTE_TARGET, 'ghostty')
    await openWorkspaceEditor(REMOTE_TARGET, 'vscode')

    expect(mocks.openRemoteInPreferredTerminal).toHaveBeenCalledWith('example', '/workspace', 'ghostty')
    expect(mocks.openRemoteInPreferredEditor).toHaveBeenCalledWith('example', '/workspace', 'vscode')
  })

  test('fast-fails remote finder requests without resolving SSH state', async () => {
    await expect(openWorkspaceInFinder(REMOTE_TARGET)).resolves.toEqual({
      ok: false,
      message: 'error.invalid-path',
    })
    expect(mocks.resolveWorkspaceFilesystemExecution).not.toHaveBeenCalled()
    expect(mocks.openInFinder).not.toHaveBeenCalled()
  })
})
