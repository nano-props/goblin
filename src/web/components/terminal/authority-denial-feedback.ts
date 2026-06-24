import type { AuthorizationDenialReason } from '#/web/components/terminal/authority-gate.ts'

/**
 * Maps a `AuthorityGate` denial reason to the i18n key the UI
 * surfaces in a toast. `null` means "do not show a toast" — the
 * `slot-closed` case is intentionally silent because the session
 * the user was typing into is gone and a toast is just noise.
 *
 * Keeping the map as a typed const (per the AGENTS.md i18n rule)
 * means new `AuthorizationDenialReason` variants surface as a
 * compile error here instead of silently dropping the toast.
 */
export const WRITE_BLOCKED_KEY_BY_REASON: Record<AuthorizationDenialReason, string | null> = {
  'slot-closed': null,
  'no-bridge': 'terminal.write-blocked-bridge-unavailable',
  'session-unknown': 'terminal.write-blocked-session-gone',
  'client-offline': 'terminal.write-blocked-reconnecting',
  'takeover-rejected': 'terminal.write-blocked-rejected',
}
