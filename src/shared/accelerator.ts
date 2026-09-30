const MODIFIERS = ['Command', 'Control', 'Alt', 'Shift'] as const
const PRIMARY_MODIFIERS = new Set<string>(['Command', 'Control', 'Alt'])
const SPECIAL_SHORTCUT_KEYS = new Set<string>([',', '.', '[', ']'])
const MAX_ACCELERATOR_LENGTH = 128

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

function parseAccelerator(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length > MAX_ACCELERATOR_LENGTH) return null
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

export function formatAccelerator(accelerator: string): string {
  return acceleratorToKeyLabels(accelerator).join('')
}

export function acceleratorToKeyLabels(accelerator: string): string[] {
  const normalized = normalizeCmdOrCtrl(accelerator)
  const parsed = parseAccelerator(normalized)
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
