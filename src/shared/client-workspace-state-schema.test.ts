import { describe, expect, test } from 'vitest'
import { parseClientWorkspaceStateJson, stringifyClientWorkspaceState } from '#/shared/client-workspace-state-schema.ts'
import { defaultClientWorkspaceState } from '#/shared/settings-defaults.ts'

describe('client workspace state JSON codec', () => {
  test('persists the state object directly without a version envelope', () => {
    const state = { ...defaultClientWorkspaceState(), zenMode: true, showActiveWorkspaceOnly: true }
    const serialized = stringifyClientWorkspaceState(state)

    expect(JSON.parse(serialized)).toEqual(state)
    expect(JSON.parse(serialized)).not.toHaveProperty('version')
    expect(JSON.parse(serialized)).not.toHaveProperty('state')
    expect(parseClientWorkspaceStateJson(serialized)).toEqual(state)
  })

  test('defaults the workspace filter to all when omitted from a saved snapshot', () => {
    const { showActiveWorkspaceOnly, ...snapshot } = defaultClientWorkspaceState()

    expect(parseClientWorkspaceStateJson(JSON.stringify(snapshot))).toEqual({
      ...snapshot,
      showActiveWorkspaceOnly,
    })
  })

  test('rejects a version envelope instead of creating a second persistence format', () => {
    const enveloped = JSON.stringify({ version: 1, state: defaultClientWorkspaceState() })

    expect(() => parseClientWorkspaceStateJson(enveloped)).toThrow()
  })

  test('rejects a branch view preference with a non-canonical workspace identity', () => {
    const state = {
      ...defaultClientWorkspaceState(),
      branchViewModeByWorkspace: { '/tmp/repo': 'worktrees' as const },
    }

    expect(() => stringifyClientWorkspaceState(state)).toThrow()
  })
})
