import * as v from 'valibot'
import type { ClientWorkspaceState } from '#/shared/api-types.ts'
import { parseTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import { canonicalWorkspaceLocator, workspaceLocatorsShareTransport } from '#/shared/workspace-locator.ts'
import { WorkspaceIdSchema } from '#/shared/workspace-locator-schema.ts'
import { parseWorkspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'

const CanonicalKeyArraySchema = v.pipe(
  v.array(
    v.pipe(
      v.string(),
      v.nonEmpty(),
      v.check((value) => !value.includes('\0')),
    ),
  ),
  v.check((value) => new Set(value).size === value.length, 'duplicate persisted keys'),
)

const FiletreeSessionViewStateSchema = v.strictObject({
  selectedKeys: CanonicalKeyArraySchema,
  expandedKeys: CanonicalKeyArraySchema,
  topVisibleRowIndex: v.pipe(v.number(), v.finite(), v.minValue(0), v.integer()),
})

export const ClientWorkspaceStateSchema = v.pipe(
  v.strictObject({
    restoredWorkspaceId: v.nullable(WorkspaceIdSchema),
    zenMode: v.boolean(),
    workspacePaneSize: v.pipe(
      v.number(),
      v.finite(),
      v.minValue(10),
      v.maxValue(90),
      v.check((value) => Math.round(value * 10) / 10 === value, 'workspace pane size must use one decimal place'),
    ),
    selectedTerminalSessionIdByTerminalFilesystemTarget: v.record(v.string(), v.string()),
    preferredWorkspacePaneTabByTargetByWorkspace: v.record(
      v.string(),
      v.record(v.string(), v.nullable(v.picklist(['status', 'changes', 'history', 'files', 'terminal']))),
    ),
    filetreeViewStateByFilesystemTargetByWorkspace: v.record(
      v.string(),
      v.record(v.string(), FiletreeSessionViewStateSchema),
    ),
  }),
  v.check(hasCanonicalClientWorkspaceIdentities, 'invalid client workspace identity'),
)

export function decodeCurrentClientWorkspaceState(value: unknown): ClientWorkspaceState {
  return v.parse(ClientWorkspaceStateSchema, value)
}

/**
 * Client workspace persistence is the current state object itself. Keep this
 * codec shared by Electron and Web: do not add a version/envelope at either
 * storage adapter, because that turns an application update into a boot gate.
 * Evolve the state schema directly and let the startup owner decide how an
 * invalid snapshot recovers.
 */
export function parseClientWorkspaceStateJson(raw: string): ClientWorkspaceState {
  return decodeCurrentClientWorkspaceState(JSON.parse(raw))
}

export function stringifyClientWorkspaceState(state: ClientWorkspaceState): string {
  return JSON.stringify(decodeCurrentClientWorkspaceState(state))
}

function hasCanonicalClientWorkspaceIdentities(state: ClientWorkspaceState): boolean {
  for (const [key, sessionId] of Object.entries(state.selectedTerminalSessionIdByTerminalFilesystemTarget)) {
    if (!parseTerminalFilesystemTargetKey(key) || !sessionId) return false
  }
  for (const [workspaceId, byTarget] of Object.entries(state.preferredWorkspacePaneTabByTargetByWorkspace)) {
    if (canonicalWorkspaceLocator(workspaceId) !== workspaceId) return false
    for (const targetKey of Object.keys(byTarget)) {
      if (parseWorkspacePaneTabsTargetIdentityKey(targetKey)?.workspaceId !== workspaceId) return false
    }
  }
  for (const [workspaceId, byFilesystemTarget] of Object.entries(
    state.filetreeViewStateByFilesystemTargetByWorkspace,
  )) {
    if (canonicalWorkspaceLocator(workspaceId) !== workspaceId) return false
    for (const filesystemTargetId of Object.keys(byFilesystemTarget)) {
      if (
        canonicalWorkspaceLocator(filesystemTargetId) !== filesystemTargetId ||
        !workspaceLocatorsShareTransport(workspaceId, filesystemTargetId)
      ) {
        return false
      }
    }
  }
  return true
}
