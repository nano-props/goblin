import type { TerminalVirtualKey } from '#/web/components/terminal/types.ts'

interface TerminalComposerCommandKey {
  key: TerminalVirtualKey
  labelKey: string
  keycap: string
}

const EDITING_COMMAND_KEYS = [
  { key: 'enter', labelKey: 'enter', keycap: '↵' },
  { key: 'backspace', labelKey: 'backspace', keycap: '⌫' },
  { key: 'tab', labelKey: 'tab', keycap: '⇥' },
] as const satisfies readonly TerminalComposerCommandKey[]

const CONTROL_COMMAND_KEYS = [
  { key: 'escape', labelKey: 'escape', keycap: 'Esc' },
  { key: 'interrupt', labelKey: 'ctrlC', keycap: '^C' },
  { key: 'eof', labelKey: 'ctrlD', keycap: '^D' },
] as const satisfies readonly TerminalComposerCommandKey[]

export const TERMINAL_COMPOSER_COMMAND_KEY_GROUPS = [
  { id: 'editing', keys: EDITING_COMMAND_KEYS },
  { id: 'control', keys: CONTROL_COMMAND_KEYS },
] as const

export const TERMINAL_COMPOSER_COMMAND_KEYS = [...EDITING_COMMAND_KEYS, ...CONTROL_COMMAND_KEYS] as const

export type TerminalComposerCommandLabelKey = (typeof TERMINAL_COMPOSER_COMMAND_KEYS)[number]['labelKey']
export type TerminalComposerCommandKeyName = (typeof TERMINAL_COMPOSER_COMMAND_KEYS)[number]['key']
