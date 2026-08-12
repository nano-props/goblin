import {
  runSerializedInitialWorkspaceProbe,
  type WorkspaceRuntimeEpochCapability,
} from '#/server/modules/workspace-runtimes.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'

interface TestWorkspaceRuntimeEpochScope {
  userId: string
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}

export function testWorkspaceRuntimeEpochCapability(
  scope: TestWorkspaceRuntimeEpochScope,
): WorkspaceRuntimeEpochCapability {
  return {
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    workspaceRuntimeId: scope.workspaceRuntimeId,
    isCurrent: () => true,
    assertCurrent: () => {},
  }
}

export async function settleWorkspaceProbeForTest(
  scope: TestWorkspaceRuntimeEpochScope,
  probe: WorkspaceSettledProbeState,
): Promise<void> {
  await runSerializedInitialWorkspaceProbe({
    ...scope,
    probe: async () => probe,
  })
}
