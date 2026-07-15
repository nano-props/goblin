// @vitest-environment node

import { describe, expect, test } from 'vitest'
import {
  WorkspacePaneEpochOverlay,
  projectRuntimePlacements,
  providerRevisionMap,
  runtimePlacementHints,
} from '#/server/workspace-pane/workspace-pane-epoch-overlay.ts'
import { testPhysicalWorktreeIdentity } from '#/server/test-utils/physical-worktree-identity.ts'
import {
  workspacePaneRuntimeTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'

const scope = { userId: 'user-a', repoRoot: '/repo', repoRuntimeId: 'runtime-a' }
const target = { kind: 'worktree' as const, repoRoot: '/repo', worktreePath: '/repo/worktree' }

describe('workspace pane epoch overlay', () => {
  test('projects runtime tabs through static gaps without copying static order', () => {
    const status = workspacePaneStaticTabEntry('status')
    const files = workspacePaneStaticTabEntry('files')
    const history = workspacePaneStaticTabEntry('history')
    const first = workspacePaneRuntimeTabEntry('terminal', 'term-firstfirstfirstfirstfi1')
    const middle = workspacePaneRuntimeTabEntry('terminal', 'term-middlemiddlemiddlemidd1')
    const last = workspacePaneRuntimeTabEntry('terminal', 'term-lastlastlastlastlast1')
    const hints = runtimePlacementHints([first, status, middle, files, history, last])

    expect(projectRuntimePlacements({ staticTabs: [status, files, history], hints, liveRuntimeTabs: [last, middle, first] }))
      .toEqual([first, status, middle, files, history, last])
    expect(projectRuntimePlacements({ staticTabs: [files, history], hints, liveRuntimeTabs: [last, middle, first] }))
      .toEqual([first, middle, files, history, last])
    expect(hints).toEqual([
      { identity: workspacePaneTabEntryIdentity(first), afterStaticCandidates: [] },
      { identity: workspacePaneTabEntryIdentity(middle), afterStaticCandidates: [status.tabId] },
      { identity: workspacePaneTabEntryIdentity(last), afterStaticCandidates: [history.tabId, files.tabId, status.tabId] },
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
    overlay.registerPhysicalTarget({ ...scope, target, identity })
    overlay.registerPhysicalTarget({ ...scope, userId: 'user-b', target, identity })

    expect(overlay.activeEpochs('/repo')).toHaveLength(2)
    expect(overlay.physicalTargets(identity)).toHaveLength(2)
    overlay.closeEpoch(scope)
    expect(overlay.activeEpochs('/repo')).toHaveLength(1)
    expect(overlay.physicalTargets(identity)).toHaveLength(1)
  })

  test('rejects duplicate provider types and keys revisions by type', () => {
    expect(providerRevisionMap([{ type: 'terminal', revision: 2 }])).toEqual(new Map([['terminal', 2]]))
    expect(() => providerRevisionMap([
      { type: 'terminal', revision: 1 },
      { type: 'terminal', revision: 2 },
    ])).toThrow('error.workspace-tabs-provider-type-duplicate')
  })
})
