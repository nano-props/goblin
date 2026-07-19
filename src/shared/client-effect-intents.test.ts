import { describe, expect, test } from 'vitest'
import { isClientEffectIntent } from '#/shared/client-effect-intents.ts'

describe('isClientEffectIntent', () => {
  test('accepts workspace pane tab intents with a known tab type', () => {
    expect(isClientEffectIntent({ type: 'show-workspace-pane-tab-requested', tab: 'changes' })).toBe(true)
    expect(isClientEffectIntent({ type: 'show-workspace-pane-tab-requested', tab: 'terminal' })).toBe(true)
  })

  test('rejects malformed workspace pane tab intents before command routing', () => {
    expect(isClientEffectIntent({ type: 'show-workspace-pane-tab-requested', tab: 'bad' })).toBe(false)
    expect(isClientEffectIntent({ type: 'show-workspace-pane-tab-requested' })).toBe(false)
  })

  test('validates payload-bearing intent variants', () => {
    expect(isClientEffectIntent({ type: 'cycle-workspace-requested', direction: 1 })).toBe(true)
    expect(isClientEffectIntent({ type: 'cycle-workspace-requested', direction: 0 })).toBe(false)
    expect(isClientEffectIntent({ type: 'open-settings-requested', page: 'about' })).toBe(true)
    expect(isClientEffectIntent({ type: 'open-settings-requested', page: 'missing' })).toBe(false)
    expect(isClientEffectIntent({ type: 'theme-pref-set-requested', pref: 'dark' })).toBe(true)
    expect(isClientEffectIntent({ type: 'theme-pref-set-requested', pref: 'sepia' })).toBe(false)
    expect(isClientEffectIntent({ type: 'lang-pref-set-requested', pref: 'zh' })).toBe(true)
    expect(isClientEffectIntent({ type: 'lang-pref-set-requested', pref: 'fr' })).toBe(false)
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
    expect(
      isClientEffectIntent({ type: 'terminal-bell-click', terminalSessionId: 1 }),
    ).toBe(false)
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
          presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'main' } },
        },
      }),
    ).toBe(false)
  })

  test('accepts only valid recent repo entries', () => {
    expect(
      isClientEffectIntent({
        type: 'open-recent-workspace-requested',
        entry: { kind: 'local', id: 'goblin+file:///tmp/repo' },
      }),
    ).toBe(true)
    expect(isClientEffectIntent({ type: 'open-recent-workspace-requested', entry: { kind: 'local', id: '' } })).toBe(
      false,
    )
    expect(
      isClientEffectIntent({ type: 'open-recent-workspace-requested', entry: { kind: 'remote', id: 'remote:repo' } }),
    ).toBe(false)
  })
})
