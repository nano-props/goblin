import { describe, expect, test } from 'vitest'
import { isRendererEffectIntent } from '#/shared/renderer-effect-intents.ts'

describe('isRendererEffectIntent', () => {
  test('accepts workspace pane view intents with a known tab type', () => {
    expect(isRendererEffectIntent({ type: 'show-workspace-pane-view-requested', tab: 'changes' })).toBe(true)
    expect(isRendererEffectIntent({ type: 'show-workspace-pane-view-requested', tab: 'terminal' })).toBe(true)
  })

  test('rejects malformed workspace pane view intents before command routing', () => {
    expect(isRendererEffectIntent({ type: 'show-workspace-pane-view-requested', tab: 'bad' })).toBe(false)
    expect(isRendererEffectIntent({ type: 'show-workspace-pane-view-requested' })).toBe(false)
  })

  test('validates payload-bearing intent variants', () => {
    expect(isRendererEffectIntent({ type: 'cycle-repo-requested', direction: 1 })).toBe(true)
    expect(isRendererEffectIntent({ type: 'cycle-repo-requested', direction: 0 })).toBe(false)
    expect(isRendererEffectIntent({ type: 'open-settings-requested', page: 'about' })).toBe(true)
    expect(isRendererEffectIntent({ type: 'open-settings-requested', page: 'missing' })).toBe(false)
    expect(isRendererEffectIntent({ type: 'theme-pref-set-requested', pref: 'dark' })).toBe(true)
    expect(isRendererEffectIntent({ type: 'theme-pref-set-requested', pref: 'sepia' })).toBe(false)
    expect(isRendererEffectIntent({ type: 'lang-pref-set-requested', pref: 'zh' })).toBe(true)
    expect(isRendererEffectIntent({ type: 'lang-pref-set-requested', pref: 'fr' })).toBe(false)
    expect(isRendererEffectIntent({ type: 'terminal-bell-click', repoRoot: '/tmp/repo', key: 'slot-1' })).toBe(true)
    expect(isRendererEffectIntent({ type: 'terminal-bell-click', repoRoot: '/tmp/repo', key: 1 })).toBe(false)
  })

  test('accepts only valid recent repo entries', () => {
    expect(isRendererEffectIntent({ type: 'open-recent-repo-requested', entry: { kind: 'local', id: '/tmp/repo' } })).toBe(
      true,
    )
    expect(isRendererEffectIntent({ type: 'open-recent-repo-requested', entry: { kind: 'local', id: '' } })).toBe(false)
    expect(isRendererEffectIntent({ type: 'open-recent-repo-requested', entry: { kind: 'remote', id: 'remote:repo' } }))
      .toBe(false)
  })
})
