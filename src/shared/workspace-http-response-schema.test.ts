import { expect, test } from 'vitest'
import * as v from 'valibot'
import {
  StringArrayResponseSchema,
  WorkspaceProbeWithoutGitProjectionResponseSchema,
  WorkspaceFilesystemTreeResponseSchema,
  WorkspaceRuntimeOpenIdResponseSchema,
} from '#/shared/workspace-http-response-schema.ts'

test('rejects malformed runtime identities and unknown response fields', () => {
  expect(() =>
    v.parse(WorkspaceRuntimeOpenIdResponseSchema, {
      ok: true,
      workspaceRuntimeId: '',
    }),
  ).toThrow()
  expect(() =>
    v.parse(WorkspaceRuntimeOpenIdResponseSchema, {
      ok: true,
      workspaceRuntimeId: 'runtime_0123456789abcdef',
      legacyId: 'old',
    }),
  ).toThrow()
})

test('rejects partial filesystem nodes rather than accepting an incomplete authority', () => {
  expect(() =>
    v.parse(WorkspaceFilesystemTreeResponseSchema, {
      nodes: [{ id: 'src', path: 'src', name: 'src', parentId: null, kind: 'directory' }],
      truncated: false,
    }),
  ).toThrow()
})

test('requires every path suggestion to be a string', () => {
  expect(() => v.parse(StringArrayResponseSchema, ['/repo', null])).toThrow()
})

test('rejects a Git-ready probe when the authoritative projection is absent', () => {
  expect(() =>
    v.parse(WorkspaceProbeWithoutGitProjectionResponseSchema, {
      status: 'ready',
      name: 'workspace',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
      diagnostics: [],
    }),
  ).toThrow()
})
