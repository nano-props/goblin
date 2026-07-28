import { describe, expect, test } from 'vitest'
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

describe('workspace HTTP response schemas', () => {
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
    const runtimeOpenResponse = {
      ok: true as const,
      workspace: { id: workspaceId },
      workspaceRuntimeId: 'runtime_test000000000000',
      capabilities: readyProbe.capabilities,
      diagnostics: [],
    }
    const lifecycleResponse = {
      kind: 'settled' as const,
      workspaceId,
      lifecycle: { kind: 'ready' as const, attemptId: 1, target },
    }

    expect(v.parse(WorkspaceProbeStateResponseSchema, readyProbe)).toEqual(readyProbe)
    expect(v.parse(WorkspaceRuntimeOpenResponseSchema, runtimeOpenResponse)).toEqual(runtimeOpenResponse)
    expect(v.parse(RemoteLifecycleResponseSchema, lifecycleResponse)).toEqual(lifecycleResponse)
    expect(v.safeParse(WorkspaceProbeStateResponseSchema, { ...readyProbe, name: 'Documents' }).success).toBe(false)
    expect(
      v.safeParse(WorkspaceRuntimeOpenResponseSchema, {
        ...runtimeOpenResponse,
        workspace: { ...runtimeOpenResponse.workspace, name: 'Documents' },
      }).success,
    ).toBe(false)
    expect(
      v.safeParse(RemoteLifecycleResponseSchema, {
        ...lifecycleResponse,
        name: 'Documents',
      }).success,
    ).toBe(false)
  })
})
