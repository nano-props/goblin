// Keyboard shortcuts cheat-sheet. Dismissed via Esc / click-outside /
// the close button (all handled by Modal).

import { Modal } from '#/renderer/components/Modal.tsx'
import { useT } from '#/renderer/stores/i18n.ts'

interface Props {
  open: boolean
  onClose: () => void
}

const SECTIONS: { titleKey: string; rows: { keys: string[]; labelKey: string }[] }[] = [
  {
    titleKey: 'help.section.nav',
    rows: [
      { keys: ['j', '↓'], labelKey: 'help.row.nextBranch' },
      { keys: ['k', '↑'], labelKey: 'help.row.prevBranch' },
      { keys: ['⌘', ']'], labelKey: 'help.row.nextRepo' },
      { keys: ['⌘', '['], labelKey: 'help.row.prevRepo' },
    ],
  },
  {
    titleKey: 'help.section.views',
    rows: [
      { keys: ['⌘', '2'], labelKey: 'help.row.viewStatus' },
      { keys: ['⌘', '3'], labelKey: 'help.row.viewLog' },
    ],
  },
  {
    titleKey: 'help.section.actions',
    rows: [
      { keys: ['Enter'], labelKey: 'help.row.checkout' },
      { keys: ['⌘', 'O'], labelKey: 'help.row.openRepo' },
      { keys: ['⌥', 'G'], labelKey: 'help.row.activateWindow' },
      { keys: ['⌘', '⇧', 'W'], labelKey: 'help.row.closeRepo' },
      { keys: ['⌘', 'R'], labelKey: 'help.row.refresh' },
      { keys: ['⌘', ','], labelKey: 'help.row.settings' },
      { keys: ['?'], labelKey: 'help.row.thisHelp' },
      { keys: ['Esc'], labelKey: 'help.row.dismiss' },
    ],
  },
]

function KeyChips({ keys }: { keys: string[] }) {
  return (
    <span className="flex gap-1 shrink-0">
      {keys.map((k, i) => (
        <span key={i} className="kbd">
          {k}
        </span>
      ))}
    </span>
  )
}

function ShortcutSection({ section }: { section: (typeof SECTIONS)[number] }) {
  const t = useT()
  return (
    <section className="rounded-lg border border-border bg-card/60 p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t(section.titleKey)}
      </div>
      <ul className="space-y-1">
        {section.rows.map((row) => (
          <li key={row.labelKey} className="flex min-h-6 items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-foreground">{t(row.labelKey)}</span>
            <KeyChips keys={row.keys} />
          </li>
        ))}
      </ul>
    </section>
  )
}

export function HelpOverlay({ open, onClose }: Props) {
  const t = useT()
  const [nav, views, actions] = SECTIONS
  return (
    <Modal open={open} title={t('help.title')} onClose={onClose} widthClass="sm:max-w-2xl">
      <div className="grid gap-3 sm:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-3">
          <ShortcutSection section={nav} />
          <ShortcutSection section={views} />
        </div>
        <ShortcutSection section={actions} />
      </div>
    </Modal>
  )
}
