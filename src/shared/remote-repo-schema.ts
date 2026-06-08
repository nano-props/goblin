import * as v from 'valibot'

export const RemoteAbsolutePathSchema = v.pipe(
  v.string(),
  v.check((value) => value.startsWith('/') && !value.includes('\0'), 'Invalid remote path'),
)

export const RemoteRepoRefSchema = v.object({
  id: v.string(),
  alias: v.string(),
  remotePath: RemoteAbsolutePathSchema,
  displayName: v.string(),
})

export const RepoSessionEntrySchema = v.union([
  v.object({
    kind: v.literal('local'),
    id: v.string(),
  }),
  v.object({
    kind: v.literal('remote'),
    id: v.string(),
    ref: RemoteRepoRefSchema,
  }),
])
