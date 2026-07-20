import * as v from 'valibot'
import { WorkspacePaneFilesystemExecutionTargetSchema } from '#/shared/workspace-pane-tabs-validators.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'

export interface WorkspaceFilesystemInvalidationEvent {
  type: 'workspace-filesystem-invalidated'
  target: WorkspacePaneFilesystemExecutionTarget
}

export function isWorkspaceFilesystemInvalidationEvent(value: unknown): value is WorkspaceFilesystemInvalidationEvent {
  if (!value || typeof value !== 'object') return false
  if (Reflect.get(value, 'type') !== 'workspace-filesystem-invalidated') return false
  return v.safeParse(WorkspacePaneFilesystemExecutionTargetSchema, Reflect.get(value, 'target')).success
}
