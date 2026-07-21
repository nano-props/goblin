import type { WorkspacePickerItem } from '#/web/components/workspace-picker/types.ts'
import {
  isRemoteWorkspaceConnectionTerminal,
  type RemoteWorkspaceConnectionLifecycle,
  type RemoteWorkspaceTarget,
} from '#/shared/remote-workspace.ts'

/**
 * Structural equality for the lifecycle union as it appears on a
 * `WorkspacePickerItem`. The `connecting` variant has no fields, while
 * terminal variants include the rendered remote locator.
 */
function remoteTargetEqual(a: RemoteWorkspaceTarget, b: RemoteWorkspaceTarget): boolean {
  return (
    a.id === b.id &&
    a.alias === b.alias &&
    a.host === b.host &&
    a.user === b.user &&
    a.port === b.port &&
    a.remotePath === b.remotePath &&
    a.displayName === b.displayName
  )
}

function lifecycleEqual(
  a: RemoteWorkspaceConnectionLifecycle | null,
  b: RemoteWorkspaceConnectionLifecycle | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'connecting' && b.kind === 'connecting') return true
  if (a.kind === 'ready' && b.kind === 'ready') {
    return remoteTargetEqual(a.target, b.target)
  }
  if (a.kind === 'failed' && b.kind === 'failed') {
    if (a.reason !== b.reason) return false
    if (a.target && !b.target) return false
    if (!a.target && b.target) return false
    if (a.target && b.target) {
      return remoteTargetEqual(a.target, b.target)
    }
    return true
  }
  return !isRemoteWorkspaceConnectionTerminal(a) && !isRemoteWorkspaceConnectionTerminal(b)
}

export function workspacePickerItemsEqual(a: WorkspacePickerItem[], b: WorkspacePickerItem[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.gitCapability !== y.gitCapability ||
      (x.terminalBellCount ?? 0) !== (y.terminalBellCount ?? 0)
    )
      return false
    if (!lifecycleEqual(x.lifecycle, y.lifecycle)) return false
    if ((x.git === null) !== (y.git === null)) return false
    if (!x.git || !y.git) continue
    if (x.git.remoteDetails === y.git.remoteDetails) continue
    if (!x.git.remoteDetails || !y.git.remoteDetails) return false
    if (x.git.remoteDetails.length !== y.git.remoteDetails.length) return false
    for (let j = 0; j < x.git.remoteDetails.length; j++) {
      const xr = x.git.remoteDetails[j]
      const yr = y.git.remoteDetails[j]
      if (!xr || !yr || xr.name !== yr.name || xr.fetchUrl !== yr.fetchUrl || xr.pushUrl !== yr.pushUrl) return false
    }
  }
  return true
}
