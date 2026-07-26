import { expect, test } from 'vitest'
import * as v from 'valibot'
import {
  RemoteLifecycleResponseSchema,
  StringArrayResponseSchema,
  WorkspaceFilesystemTreeResponseSchema,
  WorkspaceProbeStateResponseSchema,
  WorkspaceRuntimeOpenResponseSchema,
  WorkspaceRuntimeOpenIdResponseSchema,
} from '#/shared/workspace-http-response-schema.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

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

test('rejects legacy workspace names in runtime response contracts', () => {
  const workspaceId = workspaceIdForTest('goblin+ssh://example/srv/Documents')
  const readyProbe = {
    status: 'ready' as const,
    capabilities: {
      files: { read: true as const, write: true },
      terminal: { available: true },
      git: { status: 'unavailable' as const },
    },
    diagnostics: [],
  }
  const target = {
    id: workspaceId,
    alias: 'example',
    remotePath: '/srv/Documents',
    displayName: 'example:Documents',
    host: 'example.test',
    user: 'developer',
    port: 22,
  }

  expect(v.safeParse(WorkspaceProbeStateResponseSchema, { ...readyProbe, name: 'Documents' }).success).toBe(false)
  expect(
    v.safeParse(WorkspaceRuntimeOpenResponseSchema, {
      ok: true,
      workspace: { id: workspaceId, name: 'Documents' },
      workspaceRuntimeId: 'runtime_test000000000000',
      capabilities: readyProbe.capabilities,
      diagnostics: [],
    }).success,
  ).toBe(false)
  expect(
    v.safeParse(RemoteLifecycleResponseSchema, {
      kind: 'settled',
      workspaceId,
      name: 'Documents',
      lifecycle: { kind: 'ready', attemptId: 1, target },
    }).success,
  ).toBe(false)
})
