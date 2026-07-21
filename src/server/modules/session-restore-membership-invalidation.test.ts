import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { formatWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'
import { createTestWorkspacePaneTabsHost } from '#/server/test-utils/workspace-pane-tabs-host.ts'

vi.mock('#/server/modules/workspace-probe.ts', () => ({
  probeWorkspace: vi.fn(async () => ({
    status: 'unavailable' as const,
    reason: 'error.workspace-path-not-found' as const,
  })),
}))

let dataDir: string
const previousDataDir = process.env.GOBLIN_SERVER_DATA_DIR
const RESTORE_USER_ID = 'restore-user'
const OTHER_USER_ID = 'other-user'

beforeEach(() => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'goblin-session-restore-membership-'))
  process.env.GOBLIN_SERVER_DATA_DIR = dataDir
})

afterEach(async () => {
  const settings = await import('#/server/modules/settings-source.ts')
  const runtimes = await import('#/server/modules/workspace-runtimes.ts')
  settings.resetServerSettingsSourceForTests()
  runtimes.clearWorkspaceRuntimesForUser(RESTORE_USER_ID)
  runtimes.clearWorkspaceRuntimesForUser(OTHER_USER_ID)
  rmSync(dataDir, { recursive: true, force: true })
  if (previousDataDir === undefined) delete process.env.GOBLIN_SERVER_DATA_DIR
  else process.env.GOBLIN_SERVER_DATA_DIR = previousDataDir
  vi.resetModules()
})

test('restore batch repair invalidates every runtime projected from removed durable memberships', async () => {
  const settings = await import('#/server/modules/settings-source.ts')
  const runtimes = await import('#/server/modules/workspace-runtimes.ts')
  const { restoreServerWorkspace } = await import('#/server/modules/session-restore.ts')
  const retainedWorkspaceId = workspaceIdForCurrentPlatform('/retained-workspace')
  const removedWorkspaceA = workspaceIdForOtherPlatform('A')
  const removedWorkspaceB = workspaceIdForOtherPlatform('B')
  const retainedEntry = { id: retainedWorkspaceId }
  const removedEntryA = { id: removedWorkspaceA }
  const removedEntryB = { id: removedWorkspaceB }

  await settings.addServerWorkspaceEntry(retainedEntry)
  await settings.addServerWorkspaceEntry(removedEntryA)
  await settings.addServerWorkspaceEntry(removedEntryB)
  settings.resetServerSettingsSourceForTests()
  expect((await settings.getServerWorkspaceState()).openWorkspaceEntries).toEqual([
    retainedEntry,
    removedEntryA,
    removedEntryB,
  ])

  const retainedRuntimeId = runtimes.acquireWorkspaceRuntime(OTHER_USER_ID, retainedWorkspaceId, 'client_retained')
  const removedRuntimeA = runtimes.acquireWorkspaceRuntime(OTHER_USER_ID, removedWorkspaceA, 'client_removed_a')
  const removedRuntimeB = runtimes.acquireWorkspaceRuntime(RESTORE_USER_ID, removedWorkspaceB, 'client_removed_b')
  const resourceRetention = runtimes.retainWorkspaceRuntimeResource(
    OTHER_USER_ID,
    removedWorkspaceA,
    removedRuntimeA,
    'terminal-removed-a',
  )

  const result = await restoreServerWorkspace({
    userId: RESTORE_USER_ID,
    clientId: 'client_restore',
    activeWorkspaceId: retainedWorkspaceId,
    workspacePaneTabsHost: createTestWorkspacePaneTabsHost(),
    workspaceCapabilityTransitionHost: {
      commitGitCapabilityRemoval: vi.fn(async () => ({ kind: 'committed' as const })),
    },
  })

  expect(result).toMatchObject({ status: 'repaired', openWorkspaceEntries: [retainedEntry] })
  expect((await settings.getServerWorkspaceState()).openWorkspaceEntries).toEqual([retainedEntry])
  expect(runtimes.isCurrentWorkspaceRuntime(OTHER_USER_ID, retainedWorkspaceId, retainedRuntimeId)).toBe(true)
  expect(runtimes.isCurrentWorkspaceRuntime(OTHER_USER_ID, removedWorkspaceA, removedRuntimeA)).toBe(false)
  expect(runtimes.isCurrentWorkspaceRuntime(RESTORE_USER_ID, removedWorkspaceB, removedRuntimeB)).toBe(false)

  resourceRetention.release()
})

function workspaceIdForCurrentPlatform(workspacePath: string): WorkspaceId {
  const platform = process.platform === 'win32' ? 'win32' : 'posix'
  const nativePath = platform === 'win32' ? `C:\\${workspacePath.slice(1)}` : workspacePath
  const workspaceId = formatWorkspaceLocator({ transport: 'file', platform, path: nativePath }, platform)
  if (!workspaceId) throw new Error('test failed to create current-platform workspace id')
  return workspaceId
}

function workspaceIdForOtherPlatform(name: string): WorkspaceId {
  const platform = process.platform === 'win32' ? 'posix' : 'win32'
  const workspacePath = platform === 'win32' ? `C:\\removed-${name}` : `/removed-${name}`
  const workspaceId = formatWorkspaceLocator({ transport: 'file', platform, path: workspacePath }, platform)
  if (!workspaceId) throw new Error('test failed to create other-platform workspace id')
  return workspaceId
}
