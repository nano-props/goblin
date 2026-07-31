import { describe, expect, test } from 'vitest'
import type { RemoteWorkspaceConnectionResult, RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import type { WorkspaceProbeState, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'
import {
  planRemoteWorkspaceProbeTransition,
  projectSettledRemoteWorkspaceLifecycle,
  remoteWorkspaceLifecycleTarget,
  settledRemoteWorkspaceLifecycleResult,
  supersededRemoteWorkspaceLifecycleResult,
} from '#/server/modules/workspace-runtime-remote-policy.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const workspaceId = workspaceIdForTest('goblin+ssh://example/workspace')
const target: RemoteWorkspaceTarget = {
  id: workspaceId,
  alias: 'example',
  host: 'example.test',
  user: 'developer',
  port: 22,
  remotePath: '/workspace',
  displayName: 'example:workspace',
}
const unavailableProbe: WorkspaceSettledProbeState = {
  status: 'unavailable',
  reason: 'error.workspace-transport-unavailable',
}

describe('remote workspace runtime policy', () => {
  test('projects ready and failed connection results into settled lifecycle states', () => {
    const ready: RemoteWorkspaceConnectionResult = {
      kind: 'ready',
      gitAvailable: true,
      lifecycle: { kind: 'ready', target },
    }
    const failed: RemoteWorkspaceConnectionResult = {
      kind: 'failed',
      lifecycle: { kind: 'failed', reason: 'timeout', target },
    }

    expect(projectSettledRemoteWorkspaceLifecycle(ready, 2)).toEqual({ kind: 'ready', attemptId: 2, target })
    expect(projectSettledRemoteWorkspaceLifecycle(failed, 3)).toEqual({
      kind: 'failed',
      attemptId: 3,
      reason: 'timeout',
      target,
    })
  })

  test('reads a target only from terminal lifecycle states', () => {
    expect(remoteWorkspaceLifecycleTarget({ kind: 'idle', attemptId: 0 })).toBeNull()
    expect(remoteWorkspaceLifecycleTarget({ kind: 'connecting', attemptId: 1 })).toBeNull()
    expect(remoteWorkspaceLifecycleTarget({ kind: 'failed', attemptId: 2, reason: 'unknown' })).toBeNull()
    expect(remoteWorkspaceLifecycleTarget({ kind: 'ready', attemptId: 3, target })).toBe(target)
  })

  test('plans initial probe commits only while probing and refresh commits for settled probes', () => {
    const probing: WorkspaceProbeState = { status: 'probing' }
    expect(
      planRemoteWorkspaceProbeTransition(probing, {
        workspaceProbe: { mode: 'initial-only', probe: unavailableProbe },
      }),
    ).toEqual({ before: probing, after: unavailableProbe })
    expect(
      planRemoteWorkspaceProbeTransition(unavailableProbe, {
        workspaceProbe: { mode: 'initial-only', probe: unavailableProbe },
      }),
    ).toBeNull()
    expect(
      planRemoteWorkspaceProbeTransition(unavailableProbe, {
        workspaceProbe: { mode: 'refresh', probe: unavailableProbe },
      }),
    ).toEqual({ before: unavailableProbe, after: unavailableProbe })
  })

  test('classifies settled and superseded results from authoritative runtime inputs', () => {
    const lifecycle = { kind: 'ready' as const, attemptId: 4, target }
    expect(settledRemoteWorkspaceLifecycleResult(lifecycle)).toEqual({ kind: 'settled', lifecycle })
    expect(() => settledRemoteWorkspaceLifecycleResult({ kind: 'connecting', attemptId: 4 })).toThrow(
      'remote workspace lifecycle must be terminal before it settles',
    )
    expect(supersededRemoteWorkspaceLifecycleResult('runtime-current', 'runtime-current')).toEqual({
      kind: 'superseded',
    })
    expect(supersededRemoteWorkspaceLifecycleResult(null, 'runtime-current')).toEqual({ kind: 'stale-runtime' })
  })
})
