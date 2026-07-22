import { expect, test } from 'vitest'
import * as v from 'valibot'
import {
  StringArrayResponseSchema,
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
