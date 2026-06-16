import { useState } from 'react'
import { ChevronsUp, ChevronsDown } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'

interface MobileTerminalToolbarProps {
  onInput: (data: string) => void
  onScrollLines?: (amount: number) => void
  disabled?: boolean
  className?: string
}

type ToolbarKey =
  | { type: 'input'; label: string; value: string; title: string }
  | { type: 'scroll'; icon: React.ReactNode; amount: number; title: string }
  | { type: 'ctrl'; label: string; title: string }

// Ctrl is a sticky toggle: tap it once to arm, tap a value key to send
// the Ctrl-modified byte, then it disarms. The terminal protocol makes
// Tab/Ctrl+I and Esc/Ctrl+[ indistinguishable as bytes (0x09 and 0x1B
// respectively) — that's intrinsic, not a bug — but the toggle still
// signals intent to the user and stays correct for any future letter
// or symbol keys.
const KEYS: ToolbarKey[] = [
  { type: 'input', label: '⎋', value: '\x1b', title: 'Escape' },
  { type: 'input', label: '⇥', value: '\t', title: 'Tab' },
  { type: 'ctrl', label: '⌃', title: 'Ctrl (toggle, then press another key)' },
  { type: 'scroll', icon: <ChevronsUp className="size-4" />, amount: -12, title: 'Page Up (scroll up)' },
  { type: 'scroll', icon: <ChevronsDown className="size-4" />, amount: 12, title: 'Page Down (scroll down)' },
]

// Map a printable character to its Ctrl+<char> ASCII control code by
// zeroing the high two bits (the standard 0x1f mask). Letters map
// case-insensitively; non-@.._ characters and any multi-byte input
// pass through unchanged so weird inputs surface rather than get
// silently mangled into a different control byte.
function encodeCtrlChar(value: string): string {
  if (value.length !== 1) return value
  const code = value.toUpperCase().charCodeAt(0)
  if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code & 0x1f)
  return value
}

export function MobileTerminalToolbar({ onInput, onScrollLines, disabled, className }: MobileTerminalToolbarProps) {
  const [ctrlHeld, setCtrlHeld] = useState(false)

  return (
    <div className={cn('goblin-terminal-mobile-toolbar', className)} role="toolbar" aria-label="Terminal input helpers">
      <div className="goblin-terminal-mobile-toolbar__row">
        {KEYS.map((key, index) => {
          const isCtrlKey = key.type === 'ctrl'
          const isActive = isCtrlKey && ctrlHeld
          return (
            <Button
              key={index}
              type="button"
              size="icon"
              // The `--active` modifier class owns the Ctrl-armed
              // appearance in CSS, so we stay on the same `secondary`
              // variant for every key — keeps a single source of truth.
              variant="secondary"
              title={key.title}
              disabled={disabled}
              aria-pressed={isCtrlKey ? ctrlHeld : undefined}
              className={cn(
                'goblin-terminal-mobile-toolbar__btn',
                isActive && 'goblin-terminal-mobile-toolbar__btn--active',
              )}
              onClick={() => {
                if (isCtrlKey) {
                  setCtrlHeld((value) => !value)
                  return
                }
                if (key.type === 'scroll') {
                  onScrollLines?.(key.amount)
                  return
                }
                if (ctrlHeld) {
                  onInput(encodeCtrlChar(key.value))
                  setCtrlHeld(false)
                } else {
                  onInput(key.value)
                }
              }}
            >
              {key.type === 'scroll' ? key.icon : key.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
