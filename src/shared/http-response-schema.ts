import * as v from 'valibot'
import type { ExecResult } from '#/shared/git-types.ts'

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
  repositoryStateChanged: v.optional(v.boolean()),
  worktreeBootstrap: v.optional(WorktreeBootstrapSummaryResponseSchema),
}) satisfies v.GenericSchema<ExecResult>

export function decodeWith<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(schema: TSchema) {
  return (value: unknown): v.InferOutput<TSchema> => {
    const result = v.safeParse(schema, value)
    if (result.success) return result.output
    const issue = result.issues[0]
    const path = v.getDotPath(issue)
    throw new Error(`Invalid server response${path ? ` at ${path}` : ''}: ${issue.message}`, {
      cause: new v.ValiError(result.issues),
    })
  }
}
