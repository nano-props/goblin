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
          {i > 0 && <span className="text-[10px] text-muted-foreground/70">+</span>}
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
          {i > 0 && <span className="text-[11px] text-muted-foreground/70">/</span>}
          <KeyCombo keys={combo} />
        </span>
      ))}
    </span>
  )
}

function ShortcutSection({ section }: { section: HelpShortcutSection }) {
  const t = useT()
  return (
    <section className="min-w-0">
      <div className="mb-1.5 flex items-center gap-2 border-b border-separator pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-brand" />
        <span>{t(section.titleKey)}</span>
      </div>
      <ul className="divide-y divide-separator">
        {section.rows.map((row: HelpShortcutRow) => (
          <li
            key={`${row.labelKey}:${row.combos.map((combo) => combo.join('+')).join('/')}`}
            className="grid min-h-6 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1 text-xs"
          >
            <span className="min-w-0 truncate text-foreground">{t(row.labelKey)}</span>
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
      <div className="space-y-3">
        <div className="grid items-start gap-x-6 gap-y-4 sm:grid-cols-2">
          {helpShortcutSections(globalShortcut).map((section) => (
            <ShortcutSection key={section.titleKey} section={section} />
          ))}
        </div>
        <p className="truncate pt-0.5 text-[11px] text-muted-foreground/75">{t('help.hint')}</p>
      </div>
    </Modal>
  )
}
