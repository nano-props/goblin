/**
 * Build an inspectable browser keyboard event for listener-contract tests.
 * user-event does not expose the dispatched event for repeat/default-prevention assertions.
 */
export function keyboardEventForTest(type: 'keydown' | 'keyup', init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent(type, { bubbles: true, ...init })
}
