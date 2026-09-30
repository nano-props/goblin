import { describe, expect, test } from 'vitest'
import { isClientEffectIntent } from '#/shared/client-effect-intents.ts'

describe('isClientEffectIntent', () => {
  test('rejects a removed desktop command reset request', () => {
    expect(isClientEffectIntent({ type: 'server-command-reset-requested' })).toBe(false)
  })

  test('accepts workspace pane tab intents with a known tab type', () => {
    expect(isClientEffectIntent({ type: 'show-workspace-pane-tab-requested', tab: 'changes' })).toBe(true)
    expect(isClientEffectIntent({ type: 'show-workspace-pane-tab-requested', tab: 'terminal' })).toBe(true)
  })

  test('rejects malformed workspace pane tab intents before command routing', () => {
    expect(isClientEffectIntent({ type: 'show-workspace-pane-tab-requested', tab: 'bad' })).toBe(false)
    expect(isClientEffectIntent({ type: 'show-workspace-pane-tab-requested' })).toBe(false)
  })

  test('validates payload-bearing intent variants', () => {
    expect(
      isClientEffectIntent({
        type: 'terminal-bell-click',
        terminalSessionId: 'term-111111111111111111111',
        session: {
          target: {
            kind: 'workspace-root',
            workspaceId: 'goblin+file:///tmp/repo',
            workspaceRuntimeId: 'workspace-runtime-test',
          },
          presentation: { kind: 'workspace-root' },
        },
      }),
    ).toBe(true)
    expect(
      isClientEffectIntent({
        type: 'terminal-bell-click',
        workspaceId: 'goblin+file:///tmp/repo',
        key: 'term-111111111111111111111',
      }),
    ).toBe(false)
    expect(isClientEffectIntent({ type: 'terminal-bell-click', terminalSessionId: 1 })).toBe(false)
    expect(
      isClientEffectIntent({
        type: 'terminal-bell-click',
        terminalSessionId: 'term-111111111111111111111',
        session: {
          target: {
            kind: 'workspace-root',
            workspaceId: 'goblin+file:///tmp/repo',
            workspaceRuntimeId: 'workspace-runtime-test',
          },
          presentation: { kind: 'git-worktree' },
        },
      }),
    ).toBe(false)
  })
})
