import type { TerminalVirtualKey } from '#/web/components/terminal/types.ts'

interface TerminalComposerCommandKey {
  kind: 'virtual-key'
  key: TerminalVirtualKey
  labelKey: string
  keycap: string
}

interface TerminalComposerCopyAction {
  kind: 'copy-visible-content'
  labelKey: 'copyVisible'
}

export const TERMINAL_COMPOSER_PINNED_COMMAND_KEYS = [
  { kind: 'virtual-key', key: 'tab', labelKey: 'tab', keycap: '⇥' },
  { kind: 'virtual-key', key: 'enter', labelKey: 'enter', keycap: '↵' },
] as const satisfies readonly TerminalComposerCommandKey[]

export const TERMINAL_COMPOSER_OPTIONAL_ACTIONS = [
  { kind: 'virtual-key', key: 'backspace', labelKey: 'backspace', keycap: '⌫' },
  { kind: 'virtual-key', key: 'escape', labelKey: 'escape', keycap: 'Esc' },
  { kind: 'virtual-key', key: 'clear-screen', labelKey: 'ctrlL', keycap: '^L' },
  { kind: 'virtual-key', key: 'interrupt', labelKey: 'ctrlC', keycap: '^C' },
  { kind: 'virtual-key', key: 'eof', labelKey: 'ctrlD', keycap: '^D' },
  { kind: 'copy-visible-content', labelKey: 'copyVisible' },
] as const satisfies readonly (TerminalComposerCommandKey | TerminalComposerCopyAction)[]

export type TerminalComposerActionLabelKey =
  | (typeof TERMINAL_COMPOSER_PINNED_COMMAND_KEYS)[number]['labelKey']
  | (typeof TERMINAL_COMPOSER_OPTIONAL_ACTIONS)[number]['labelKey']
export type TerminalComposerOptionalActionLabelKey = (typeof TERMINAL_COMPOSER_OPTIONAL_ACTIONS)[number]['labelKey']
export type TerminalComposerOptionalVirtualKey = Extract<
  (typeof TERMINAL_COMPOSER_OPTIONAL_ACTIONS)[number],
  { kind: 'virtual-key' }
>['key']
