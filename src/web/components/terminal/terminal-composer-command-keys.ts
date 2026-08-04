import type { TerminalVirtualKey } from '#/web/components/terminal/types.ts'

interface TerminalComposerCommandKey {
  key: TerminalVirtualKey
  labelKey: string
  keycap: string
}

export const TERMINAL_COMPOSER_PINNED_COMMAND_KEYS = [
  { key: 'tab', labelKey: 'tab', keycap: '⇥' },
  { key: 'enter', labelKey: 'enter', keycap: '↵' },
] as const satisfies readonly TerminalComposerCommandKey[]

export const TERMINAL_COMPOSER_OPTIONAL_COMMAND_KEYS = [
  { key: 'backspace', labelKey: 'backspace', keycap: '⌫' },
  { key: 'escape', labelKey: 'escape', keycap: 'Esc' },
  { key: 'interrupt', labelKey: 'ctrlC', keycap: '^C' },
  { key: 'eof', labelKey: 'ctrlD', keycap: '^D' },
] as const satisfies readonly TerminalComposerCommandKey[]

export type TerminalComposerCommandLabelKey =
  | (typeof TERMINAL_COMPOSER_PINNED_COMMAND_KEYS)[number]['labelKey']
  | (typeof TERMINAL_COMPOSER_OPTIONAL_COMMAND_KEYS)[number]['labelKey']
export type TerminalComposerMenuCommandLabelKey = (typeof TERMINAL_COMPOSER_OPTIONAL_COMMAND_KEYS)[number]['labelKey']
export type TerminalComposerMenuCommandKeyName = (typeof TERMINAL_COMPOSER_OPTIONAL_COMMAND_KEYS)[number]['key']
