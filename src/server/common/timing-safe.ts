import { timingSafeEqual } from 'node:crypto'

/**
 * Compare two strings in constant time. Both sides must be
 * non-empty; empty vs non-empty comparison is intentionally
 * non-timing-safe because the answer is "no" either way and
 * treating it as a special case is cheaper than padding.
 *
 * Use this wherever a request supplies a secret-shaped string
 * (WebSocket auth token, internal-secret header) and the
 * attacker could otherwise use timing to learn the secret
 * prefix by prefix.
 */
export function safeEqualString(a: string, b: string): boolean {
  if (a.length === 0 || b.length !== a.length) return false
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}
