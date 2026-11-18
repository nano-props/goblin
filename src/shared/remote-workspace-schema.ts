import * as v from 'valibot'
import { WorkspaceIdSchema } from '#/shared/workspace-locator-schema.ts'

export const RemoteAbsolutePathSchema = v.pipe(
  v.string(),
  v.check((value) => value.startsWith('/') && !value.includes('\0'), 'Invalid remote path'),
)

export const WorkspaceSessionEntrySchema = v.strictObject({ id: WorkspaceIdSchema })
