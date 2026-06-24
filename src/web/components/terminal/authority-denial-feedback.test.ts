import { describe, expect, test } from 'vitest'
import type { AuthorizationDenialReason } from '#/web/components/terminal/authority-gate.ts'
import { WRITE_BLOCKED_KEY_BY_REASON } from '#/web/components/terminal/authority-denial-feedback.ts'

// Every denial reason must be mapped to either a non-null i18n
// key (the user gets a toast) or `null` (intentionally silent for
// `slot-closed` — the session is gone, no need to nag).
//
// This test exists because the map is the single source of truth for
// the user-visible denial feedback; a typo in a key, a missing
// variant, or a future `AuthorizationDenialReason` add would
// otherwise be caught only at runtime when a sibling window hits
// the bad case.
describe('WRITE_BLOCKED_KEY_BY_REASON', () => {
  test('every denial reason has a mapped i18n key or an intentional null', () => {
    const expectedShape: Record<AuthorizationDenialReason, string | null> = {
      'slot-closed': null,
      'no-bridge': 'terminal.write-blocked-bridge-unavailable',
      'session-unknown': 'terminal.write-blocked-session-gone',
      'client-offline': 'terminal.write-blocked-reconnecting',
      'takeover-rejected': 'terminal.write-blocked-rejected',
    }
    for (const [reason, expectedKey] of Object.entries(expectedShape) as Array<[AuthorizationDenialReason, string | null]>) {
      expect(WRITE_BLOCKED_KEY_BY_REASON[reason]).toBe(expectedKey)
    }
  })

  test('mapped keys are static dot-notation strings, no templates or concatenation', () => {
    // AGENTS.md requires i18n keys to be static — no
    // `t(\`foo.${bar}\`)` or `t(a + b)` patterns. The map is the
    // canonical surface that the renderer reads from, so it must
    // not contain computed keys.
    for (const [reason, key] of Object.entries(WRITE_BLOCKED_KEY_BY_REASON)) {
      if (key === null) continue
      expect(key, `key for ${reason}`).toMatch(/^[a-z]+\.[a-z-]+$/)
      expect(key, `key for ${reason}`).not.toContain('${')
      expect(key, `key for ${reason}`).not.toContain('{')
    }
  })
})
