import * as v from 'valibot'
import { toSafeCanonicalWorkspaceId, type WorkspaceId } from '#/shared/workspace-locator.ts'

/**
 * Persistence and wire data may be produced on a different host platform.
 * Platform admission belongs to the execution boundary that dereferences a
 * file locator, not to the transport codec boundary.
 */
export function isWorkspaceIdWireValue(value: unknown): value is WorkspaceId {
  return toSafeCanonicalWorkspaceId(value) !== null
}

/** Canonical workspace identity at persistence and transport boundaries. */
export const WorkspaceIdSchema = v.custom<WorkspaceId>(isWorkspaceIdWireValue, 'Invalid workspace ID')
