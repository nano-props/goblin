import type { TerminalComposerSessionState } from '#/web/components/terminal/types.ts'

export const EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST: TerminalComposerSessionState = {
  expanded: false,
  mode: 'keys',
  historyEntries: [],
}
