import * as v from 'valibot'
import { WorkspaceIdSchema } from '#/shared/workspace-locator-schema.ts'

export const RemoteAbsolutePathSchema = v.pipe(
  v.string(),
  v.check((value) => value.startsWith('/') && !value.includes('\0'), 'Invalid remote path'),
)

export const RemoteRepoRefSchema = v.object({
  id: WorkspaceIdSchema,
  alias: v.string(),
  remotePath: RemoteAbsolutePathSchema,
  displayName: v.string(),
})

export const WorkspaceSessionEntrySchema = v.union([
  v.object({
    kind: v.literal('local'),
    id: WorkspaceIdSchema,
  }),
  v.object({
    kind: v.literal('remote'),
    id: WorkspaceIdSchema,
    ref: RemoteRepoRefSchema,
  }),
])
