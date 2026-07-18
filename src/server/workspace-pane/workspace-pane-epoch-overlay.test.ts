// @vitest-environment node

import { describe, expect, test } from 'vitest'
import {
  WorkspacePaneEpochOverlay,
  projectRuntimePlacements,
  providerRevisionMap,
  runtimePlacementHints,
} from '#/server/workspace-pane/workspace-pane-epoch-overlay.ts'
import {
  issueTestPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeIdentity,
} from '#/server/test-utils/physical-worktree-identity.ts'
import { physicalWorktreeAdmissionLease } from '#/server/worktree-removal/physical-worktree-capability.ts'
import {
  workspacePaneRuntimeTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const scope = { userId: 'user-a', repoRoot: '/repo', repoRuntimeId: 'runtime-a' }
const workspaceId = canonicalWorkspaceLocator('goblin+file:///repo')
const worktreeRoot = canonicalWorkspaceLocator('goblin+file:///repo/worktree')
const linkedWorkspaceId = canonicalWorkspaceLocator('goblin+file:///linked')
const linkedWorktreeRoot = canonicalWorkspaceLocator('goblin+file:///linked/worktree')
if (!workspaceId || !worktreeRoot || !linkedWorkspaceId || !linkedWorktreeRoot) {
  throw new Error('invalid workspace locator fixture')
}
const target = { kind: 'git-worktree' as const, workspaceId, workspaceRuntimeId: 'runtime-a', root: worktreeRoot }

describe('workspace pane epoch overlay', () => {
  test('projects runtime tabs through static gaps without copying static order', () => {
    const status = workspacePaneStaticTabEntry('status')
    const files = workspacePaneStaticTabEntry('files')
    const history = workspacePaneStaticTabEntry('history')
    const first = workspacePaneRuntimeTabEntry('terminal', 'term-firstfirstfirstfirstfi1')
    const middle = workspacePaneRuntimeTabEntry('terminal', 'term-middlemiddlemiddlemidd1')
    const last = workspacePaneRuntimeTabEntry('terminal', 'term-lastlastlastlastlast1')
    const hints = runtimePlacementHints([first, status, middle, files, history, last])

    expect(
      projectRuntimePlacements({ staticTabs: [status, files, history], hints, liveRuntimeTabs: [last, middle, first] }),
    ).toEqual([first, status, middle, files, history, last])
    expect(
      projectRuntimePlacements({ staticTabs: [files, history], hints, liveRuntimeTabs: [last, middle, first] }),
    ).toEqual([first, middle, files, history, last])
    expect(hints).toEqual([
      { identity: workspacePaneTabEntryIdentity(first), afterStaticCandidates: [] },
      { identity: workspacePaneTabEntryIdentity(middle), afterStaticCandidates: [status.tabId] },
      {
        identity: workspacePaneTabEntryIdentity(last),
        afterStaticCandidates: [history.tabId, files.tabId, status.tabId],
      },
    ])
  })

  test('retains same-epoch placement hints across disappearance and clears them on epoch close', () => {
    const overlay = new WorkspacePaneEpochOverlay()
    const status = workspacePaneStaticTabEntry('status')
    const terminal = workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1')
    expect(overlay.recordMixedOrder({ ...scope, target, tabs: [status, terminal] })).toBe(true)
    expect(overlay.revision(scope)).toBe(1)
    expect(overlay.placementHints({ ...scope, target })).toHaveLength(1)

    overlay.closeEpoch(scope)

    expect(overlay.revision(scope)).toBe(0)
    expect(overlay.placementHints({ ...scope, target })).toEqual([])
  })

  test('indexes physical targets and active epochs with epoch-bounded cleanup', () => {
    const overlay = new WorkspacePaneEpochOverlay()
    const identity = testPhysicalWorktreeIdentity('/repo/worktree')
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree')
    const lease = physicalWorktreeAdmissionLease(capability)
    overlay.registerPhysicalTarget({ ...scope, target, lease })
    overlay.registerPhysicalTarget({ ...scope, userId: 'user-b', target, lease })

    expect(overlay.activeEpochs('/repo')).toHaveLength(2)
    expect(overlay.physicalTargets(identity)).toHaveLength(2)
    overlay.closeEpoch(scope)
    expect(overlay.activeEpochs('/repo')).toHaveLength(1)
    expect(overlay.physicalTargets(identity)).toHaveLength(1)
  })

  test('reconciles invalid target metadata, placement, and physical indexes with the validated catalog', () => {
    const overlay = new WorkspacePaneEpochOverlay()
    const identity = testPhysicalWorktreeIdentity('/repo/worktree')
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree')
    const lease = physicalWorktreeAdmissionLease(capability)
    const terminal = workspacePaneRuntimeTabEntry('terminal', 'term-invalidinvalidinvalid1')
    overlay.recordMixedOrder({ ...scope, target, tabs: [terminal] })
    overlay.registerPhysicalTarget({ ...scope, target, lease })

    overlay.retainTargets(scope, new Set())

    expect(overlay.placementHints({ ...scope, target })).toEqual([])
    expect(overlay.physicalTargets(identity)).toEqual([])
  })

  test('clears a removed physical identity without deleting target placement', () => {
    const overlay = new WorkspacePaneEpochOverlay()
    const identity = testPhysicalWorktreeIdentity('/repo/worktree')
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree')
    const lease = physicalWorktreeAdmissionLease(capability)
    const terminal = workspacePaneRuntimeTabEntry('terminal', 'term-stalephysicalidentity1')
    const linkedScope = { userId: 'user-a', repoRoot: '/linked', repoRuntimeId: 'runtime-linked' }
    const linkedTarget = {
      kind: 'git-worktree' as const,
      workspaceId: linkedWorkspaceId,
      workspaceRuntimeId: 'runtime-linked',
      root: linkedWorktreeRoot,
    }
    overlay.recordMixedOrder({ ...scope, target, tabs: [terminal] })
    overlay.registerPhysicalTarget({ ...scope, target, lease })
    overlay.registerPhysicalTarget({ ...linkedScope, target: linkedTarget, lease })

    expect(overlay.clearPhysicalIdentity('/repo', lease)).toEqual([scope])
    expect(overlay.physicalTargets(identity)).toEqual([{ ...linkedScope, target: linkedTarget }])
    expect(overlay.placementHints({ ...scope, target })).toHaveLength(1)
  })

  test('does not clear a rebound generation at the same physical identity', () => {
    const overlay = new WorkspacePaneEpochOverlay()
    const identity = testPhysicalWorktreeIdentity('/repo/worktree')
    const first = physicalWorktreeAdmissionLease(
      issueTestPhysicalWorktreeExecutionCapability({
        identity,
        execution: {
          kind: 'local',
          canonicalWorktreePath: identity.endpoint,
          endpointMarker: { deviceId: '1', inode: '1' },
        },
      }),
    )
    const rebound = physicalWorktreeAdmissionLease(
      issueTestPhysicalWorktreeExecutionCapability({
        identity,
        execution: {
          kind: 'local',
          canonicalWorktreePath: identity.endpoint,
          endpointMarker: { deviceId: '1', inode: '2' },
        },
      }),
    )
    overlay.registerPhysicalTarget({ ...scope, target, lease: first })
    overlay.registerPhysicalTarget({ ...scope, target, lease: rebound })

    expect(overlay.clearPhysicalIdentity('/repo', first)).toEqual([])
    expect(overlay.physicalTargets(rebound)).toEqual([{ ...scope, target }])
  })

  test('rejects duplicate provider types and keys revisions by type', () => {
    expect(providerRevisionMap([{ type: 'terminal', revision: 2 }])).toEqual(new Map([['terminal', 2]]))
    expect(() =>
      providerRevisionMap([
        { type: 'terminal', revision: 1 },
        { type: 'terminal', revision: 2 },
      ]),
    ).toThrow('error.workspace-tabs-provider-type-duplicate')
  })
})
