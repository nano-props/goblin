import * as v from 'valibot'

// Wire-level contract for `POST /api/repo/view`. The server route
// produces this shape; the `g` CLI consumes it. Defining it here
// (rather than in either side) means a shape change on either end
// fails the compile of the other end — the contract can't drift.
//
// Discriminated on `ok`: the CLI narrows automatically to pick
// `message` on failure or do nothing on success.

export const RepoViewResultSchema = v.union([
  v.strictObject({ ok: v.literal(true) }),
  v.strictObject({ ok: v.literal(false), code: v.string(), message: v.string() }),
])

export type RepoViewResult = v.InferOutput<typeof RepoViewResultSchema>
