export const DEFAULT_GLOBAL_SHORTCUT = 'Alt+G'

const MODIFIERS = ['Command', 'Control', 'Alt', 'Shift'] as const
const PRIMARY_MODIFIERS = new Set<string>(['Command', 'Control', 'Alt'])
const SPECIAL_SHORTCUT_KEYS = new Set<string>([',', '.', '[', ']'])
const MAX_GLOBAL_SHORTCUT_LENGTH = 128
const RESERVED_GLOBAL_SHORTCUTS = new Set<string>([
  'Command+O',
  'Control+O',
  'Command+Shift+O',
  'Control+Shift+O',
  'Command+Shift+R',
  'Control+Shift+R',
  'Command+N',
  'Control+N',
  'Command+T',
  'Control+T',
  'Command+1',
  'Control+1',
  'Command+2',
  'Control+2',
  'Command+3',
  'Control+3',
  'Command+4',
  'Control+4',
  'Command+5',
  'Control+5',
  'Command+6',
  'Control+6',
  'Command+7',
  'Control+7',
  'Command+8',
  'Control+8',
  'Command+9',
  'Control+9',
  'Command+J',
  'Control+J',
  'Command+R',
  'Control+R',
  'Command+B',
  'Control+B',
  'Command+U',
  'Control+U',
  'Command+W',
  'Control+W',
  'Command+Shift+T',
  'Control+Shift+T',
  'Command+Shift+W',
  'Control+Shift+W',
  'Command+Alt+I',
  'Control+Shift+I',
  'Command+]',
  'Control+]',
  'Command+[',
  'Control+[',
  'Command+,',
  'Control+,',
  'Command+A',
  'Control+A',
  'Command+C',
  'Control+C',
  'Command+V',
  'Control+V',
  'Command+X',
  'Control+X',
  'Command+Y',
  'Control+Y',
  'Command+Z',
  'Control+Z',
  'Command+Shift+Z',
  'Control+Shift+Z',
  'Command+H',
  'Command+M',
  'Command+Q',
  'Command+Alt+H',
])

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
  if (value.length > MAX_GLOBAL_SHORTCUT_LENGTH) return null
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
  const parsed = parseGlobalShortcut(value)
  return parsed && !isReservedGlobalShortcut(parsed) ? parsed : DEFAULT_GLOBAL_SHORTCUT
}

export function isReservedGlobalShortcut(accelerator: string): boolean {
  const parsed = parseGlobalShortcut(accelerator)
  return parsed !== null && RESERVED_GLOBAL_SHORTCUTS.has(parsed)
}

/** Canonical command input, excluding shortcuts owned by built-in application actions. */
export function parseAllowedGlobalShortcut(value: unknown): string | null {
  const parsed = parseGlobalShortcut(value)
  return parsed && !isReservedGlobalShortcut(parsed) ? parsed : null
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
  return acceleratorToKeyLabels(accelerator).join('')
}

export function acceleratorToKeyLabels(accelerator: string): string[] {
  const normalized = normalizeCmdOrCtrl(accelerator)
  const parsed = parseGlobalShortcut(normalized)
  if (!parsed) return [accelerator]
  return parsed.split('+').map((token) => MODIFIER_LABELS[token as (typeof MODIFIERS)[number]] ?? token)
}

function normalizeCmdOrCtrl(accelerator: string): string {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
  return accelerator
    .split('+')
    .map((token) => (token === 'CmdOrCtrl' ? (isMac ? 'Command' : 'Control') : token))
    .join('+')
}

function isAllowedShortcutKey(token: string): boolean {
  return /^[a-z0-9]$/i.test(token) || /^f([1-9]|1[0-9]|2[0-4])$/i.test(token) || SPECIAL_SHORTCUT_KEYS.has(token)
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
