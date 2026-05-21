export const DEFAULT_GLOBAL_SHORTCUT = 'Alt+G'

const MODIFIERS = ['Command', 'Control', 'Alt', 'Shift'] as const
const PRIMARY_MODIFIERS = new Set<string>(['Command', 'Control', 'Alt'])

const MODIFIER_ALIASES: Record<string, (typeof MODIFIERS)[number]> = {
  cmd: 'Command',
  command: 'Command',
  meta: 'Command',
  ctrl: 'Control',
  control: 'Control',
  option: 'Alt',
  alt: 'Alt',
  shift: 'Shift',
}

const MODIFIER_LABELS: Record<(typeof MODIFIERS)[number], string> = {
  Command: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
}

export function parseGlobalShortcut(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const tokens = value
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean)
  if (tokens.length < 2) return null

  const modifiers = new Set<(typeof MODIFIERS)[number]>()
  let key: string | null = null
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token.toLowerCase()]
    if (modifier) {
      modifiers.add(modifier)
      continue
    }
    if (key || !isAllowedShortcutKey(token)) return null
    key = normalizeShortcutKey(token)
  }

  if (!key || ![...modifiers].some((modifier) => PRIMARY_MODIFIERS.has(modifier))) return null
  return [...MODIFIERS.filter((modifier) => modifiers.has(modifier)), key].join('+')
}

export function normalizeGlobalShortcut(value: unknown): string {
  return parseGlobalShortcut(value) ?? DEFAULT_GLOBAL_SHORTCUT
}

export function globalShortcutFromKeyboardEvent(e: KeyboardEvent): string | null {
  const key = keyFromKeyboardEvent(e)
  if (!key) return null
  const modifiers = [
    e.metaKey ? 'Command' : null,
    e.ctrlKey ? 'Control' : null,
    e.altKey ? 'Alt' : null,
    e.shiftKey ? 'Shift' : null,
  ].filter((modifier): modifier is (typeof MODIFIERS)[number] => modifier !== null)
  if (!modifiers.some((modifier) => PRIMARY_MODIFIERS.has(modifier))) return null
  return [...modifiers, key].join('+')
}

export function formatAccelerator(accelerator: string): string {
  const parsed = parseGlobalShortcut(accelerator)
  if (!parsed) return accelerator
  return parsed
    .split('+')
    .map((token) => MODIFIER_LABELS[token as (typeof MODIFIERS)[number]] ?? token)
    .join('')
}

function isAllowedShortcutKey(token: string): boolean {
  return /^[a-z0-9]$/i.test(token) || /^f([1-9]|1[0-9]|2[0-4])$/i.test(token)
}

function normalizeShortcutKey(token: string): string {
  return token.toUpperCase()
}

function keyFromKeyboardEvent(e: KeyboardEvent): string | null {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3)
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) return e.code
  return null
}
