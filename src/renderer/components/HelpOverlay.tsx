// Keyboard shortcuts cheat-sheet. Dismissed via Esc / click-outside /
// the close button (all handled by Modal).

import { Modal } from '#/renderer/components/Modal.tsx'
import { useT } from '#/renderer/stores/i18n.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'
import {
  helpShortcutSections,
  type HelpShortcutRow,
  type HelpShortcutSection,
} from '#/renderer/keyboard/help-shortcuts.ts'

interface Props {
  open: boolean
  onClose: () => void
}

function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((k, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="text-[10px] text-muted-foreground/60">+</span>}
          <span className="kbd">{k}</span>
        </span>
      ))}
    </span>
  )
}

function KeyCombos({ combos }: { combos: string[][] }) {
  return (
    <span className="flex shrink-0 flex-wrap justify-end gap-x-1 gap-y-0.5">
      {combos.map((combo, i) => (
        <span key={`${combo.join('+')}:${i}`} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-[11px] text-muted-foreground/60">/</span>}
          <KeyCombo keys={combo} />
        </span>
      ))}
    </span>
  )
}

function ShortcutSection({ section }: { section: HelpShortcutSection }) {
  const t = useT()
  return (
    <section className="space-y-1.5">
      <div className="px-3 text-[11px] font-medium text-muted-foreground">{t(section.titleKey)}</div>
      <ul className="overflow-hidden rounded-xl border border-border/60 bg-background/85 shadow-[var(--shadow-inset-highlight)]">
        {section.rows.map((row: HelpShortcutRow) => (
          <li
            key={`${row.labelKey}:${row.combos.map((combo) => combo.join('+')).join('/')}`}
            className="flex min-h-10 items-center justify-between gap-4 px-3 py-2 [&+&]:border-t [&+&]:border-separator"
          >
            <span className="min-w-0 truncate text-sm text-foreground">{t(row.labelKey)}</span>
            <KeyCombos combos={row.combos} />
          </li>
        ))}
      </ul>
    </section>
  )
}

export function HelpOverlay({ open, onClose }: Props) {
  const t = useT()
  const globalShortcut = useSettingsStore((s) => s.globalShortcut)
  return (
    <Modal open={open} title={t('help.title')} onClose={onClose} widthClass="sm:max-w-2xl">
      <div className="-m-4 space-y-5 bg-muted/30 px-5 py-4">
        <p className="px-3 text-xs leading-snug text-muted-foreground">{t('help.hint')}</p>
        <div className="grid items-start gap-5 sm:grid-cols-2">
          {helpShortcutSections(globalShortcut).map((section) => (
            <ShortcutSection key={section.titleKey} section={section} />
          ))}
        </div>
      </div>
    </Modal>
  )
}
