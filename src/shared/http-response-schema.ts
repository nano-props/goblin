import * as v from 'valibot'
import {
  EXEC_RESULT_RECOVERY_MESSAGE_KEYS,
  type CreateWorktreeExecResult,
  type ExecResult,
  type RepoMutationExecResult,
} from '#/shared/git-types.ts'

const NonNegativeIntegerSchema = v.pipe(v.number(), v.finite(), v.integer(), v.minValue(0))
const WorktreeBootstrapPathSummarySchema = v.strictObject({
  count: NonNegativeIntegerSchema,
  paths: v.array(v.string()),
})

export const WorktreeBootstrapSummaryResponseSchema = v.strictObject({
  copy: WorktreeBootstrapPathSummarySchema,
  symlink: WorktreeBootstrapPathSummarySchema,
  hardlink: WorktreeBootstrapPathSummarySchema,
  skippedMissing: WorktreeBootstrapPathSummarySchema,
  setup: v.optional(v.strictObject({ command: v.string() })),
})

export const ExecResultResponseSchema = v.strictObject({
  ok: v.boolean(),
  message: v.string(),
}) satisfies v.GenericSchema<ExecResult>

export const RepoMutationExecResultResponseSchema = v.strictObject({
  ...ExecResultResponseSchema.entries,
  recoveryMessageKeys: v.optional(
    v.pipe(
      v.array(v.picklist(EXEC_RESULT_RECOVERY_MESSAGE_KEYS)),
      v.maxLength(EXEC_RESULT_RECOVERY_MESSAGE_KEYS.length),
      v.check((keys) => new Set(keys).size === keys.length, 'duplicate recovery message keys'),
    ),
  ),
  worktreeBootstrap: v.optional(WorktreeBootstrapSummaryResponseSchema),
}) satisfies v.GenericSchema<RepoMutationExecResult>

export const CreateWorktreeExecResultResponseSchema = v.variant('ok', [
  v.strictObject({ ...RepoMutationExecResultResponseSchema.entries, ok: v.literal(false) }),
  v.strictObject({
    ...RepoMutationExecResultResponseSchema.entries,
    ok: v.literal(true),
    worktreePath: v.string(),
  }),
]) satisfies v.GenericSchema<CreateWorktreeExecResult>

export function decodeWith<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(schema: TSchema) {
  return (value: unknown): v.InferOutput<TSchema> => {
    const result = v.safeParse(schema, value)
    if (result.success) return result.output
    const issue = result.issues[0]
    const path = v.getDotPath(issue)
    const error = new v.ValiError(result.issues)
    error.message = `Invalid server response${path ? ` at ${path}` : ''}: ${issue.message}`
    throw error
  }
}
