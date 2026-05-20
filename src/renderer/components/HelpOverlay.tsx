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
      { keys: ['j', '↓'], labelKey: 'help.row.next-branch' },
      { keys: ['k', '↑'], labelKey: 'help.row.prev-branch' },
      { keys: ['⌘', ']'], labelKey: 'help.row.next-repo' },
      { keys: ['⌘', '['], labelKey: 'help.row.prev-repo' },
    ],
  },
  {
    titleKey: 'help.section.views',
    rows: [
      { keys: ['⌘', '1'], labelKey: 'help.row.view-status' },
      { keys: ['⌘', '2'], labelKey: 'help.row.view-changes' },
      { keys: ['⌘', '3'], labelKey: 'help.row.view-log' },
      { keys: ['⌘', 'J'], labelKey: 'help.row.toggle-detail' },
    ],
  },
  {
    titleKey: 'help.section.branch-actions',
    rows: [
      { keys: ['Enter'], labelKey: 'help.row.checkout' },
      { keys: ['p'], labelKey: 'action.pull' },
      { keys: ['P'], labelKey: 'action.push' },
      { keys: ['g'], labelKey: 'worktrees.open-in-ghostty-label' },
      { keys: ['v'], labelKey: 'worktrees.open-in-vs-code-label' },
      { keys: ['G'], labelKey: 'action.github' },
    ],
  },
  {
    titleKey: 'help.section.actions',
    rows: [
      { keys: ['⌘', 'O'], labelKey: 'help.row.open-repo' },
      { keys: ['⌥', 'G'], labelKey: 'help.row.activate-window' },
      { keys: ['⌘', '⇧', 'W'], labelKey: 'help.row.close-repo' },
      { keys: ['⌘', 'R'], labelKey: 'help.row.refresh' },
      { keys: ['⌘', ','], labelKey: 'help.row.settings' },
      { keys: ['?'], labelKey: 'help.row.this-help' },
      { keys: ['Esc'], labelKey: 'help.row.dismiss' },
    ],
  },
]

function KeyChips({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 gap-1">
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
    <section className="rounded-xl border border-border bg-card/70 p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="h-3 w-1 rounded-full bg-brand" />
        <span>{t(section.titleKey)}</span>
      </div>
      <ul className="space-y-0.5">
        {section.rows.map((row) => (
          <li
            key={`${row.labelKey}:${row.keys.join('+')}`}
            className="-mx-1.5 grid min-h-7 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-1.5 text-sm"
          >
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
  return (
    <Modal open={open} title={t('help.title')} onClose={onClose} widthClass="sm:max-w-3xl">
      <div className="grid items-start gap-3 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <ShortcutSection key={section.titleKey} section={section} />
        ))}
      </div>
    </Modal>
  )
}
