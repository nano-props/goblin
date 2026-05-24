import { Code2, GitBranch, GitPullRequest, Terminal, type LucideIcon } from 'lucide-react'
import { Modal } from '#/renderer/components/Modal.tsx'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { useT } from '#/renderer/stores/i18n.ts'
import type { BadgeVariant } from '#/renderer/components/ui/badge.tsx'

interface Props {
  open: boolean
  onClose: () => void
}

interface DependencyItem {
  Icon: LucideIcon
  badgeVariant: BadgeVariant
  badgeKey: string
  titleKey: string
  commandKey: string
  bodyKey: string
}

const CORE: DependencyItem[] = [
  {
    Icon: GitBranch,
    badgeVariant: 'warning',
    badgeKey: 'dependencies.required',
    titleKey: 'dependencies.git.title',
    commandKey: 'dependencies.git.command',
    bodyKey: 'dependencies.git.body',
  },
  {
    Icon: GitPullRequest,
    badgeVariant: 'brand',
    badgeKey: 'dependencies.optional',
    titleKey: 'dependencies.gh.title',
    commandKey: 'dependencies.gh.command',
    bodyKey: 'dependencies.gh.body',
  },
]

const TERMINALS: DependencyItem[] = [
  {
    Icon: Terminal,
    badgeVariant: 'brand',
    badgeKey: 'dependencies.optional',
    titleKey: 'dependencies.ghostty.title',
    commandKey: 'dependencies.ghostty.command',
    bodyKey: 'dependencies.ghostty.body',
  },
  {
    Icon: Terminal,
    badgeVariant: 'brand',
    badgeKey: 'dependencies.optional',
    titleKey: 'dependencies.terminal.title',
    commandKey: 'dependencies.terminal.command',
    bodyKey: 'dependencies.terminal.body',
  },
]

const EDITORS: DependencyItem[] = [
  {
    Icon: Code2,
    badgeVariant: 'brand',
    badgeKey: 'dependencies.optional',
    titleKey: 'dependencies.vscode.title',
    commandKey: 'dependencies.vscode.command',
    bodyKey: 'dependencies.vscode.body',
  },
  {
    Icon: Code2,
    badgeVariant: 'brand',
    badgeKey: 'dependencies.optional',
    titleKey: 'dependencies.cursor.title',
    commandKey: 'dependencies.cursor.command',
    bodyKey: 'dependencies.cursor.body',
  },
  {
    Icon: Code2,
    badgeVariant: 'brand',
    badgeKey: 'dependencies.optional',
    titleKey: 'dependencies.windsurf.title',
    commandKey: 'dependencies.windsurf.command',
    bodyKey: 'dependencies.windsurf.body',
  },
]

export function DependenciesOverlay({ open, onClose }: Props) {
  const t = useT()
  return (
    <Modal open={open} title={t('dependencies.title')} onClose={onClose} widthClass="sm:max-w-2xl">
      <div className="-m-4 space-y-5 bg-muted/30 px-5 py-4">
        <p className="px-3 text-xs leading-snug text-muted-foreground">{t('dependencies.intro')}</p>
        <DependencyList items={CORE} />
        <DependencySection label={t('dependencies.group.terminals')} hint={t('dependencies.group.terminals-hint')}>
          <DependencyList items={TERMINALS} />
        </DependencySection>
        <DependencySection label={t('dependencies.group.editors')} hint={t('dependencies.group.editors-hint')}>
          <DependencyList items={EDITORS} />
        </DependencySection>
      </div>
    </Modal>
  )
}

function DependencySection({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="px-3">
        <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">{hint}</div>}
      </div>
      {children}
    </section>
  )
}

function DependencyList({ items }: { items: DependencyItem[] }) {
  return (
    <ul className="overflow-hidden rounded-xl border border-border/60 bg-background/85 shadow-[var(--shadow-inset-highlight)]">
      {items.map((item) => (
        <DependencyRow key={item.titleKey} item={item} />
      ))}
    </ul>
  )
}

function DependencyRow({ item }: { item: DependencyItem }) {
  const t = useT()
  const Icon = item.Icon
  return (
    <li className="flex min-h-14 items-center gap-3 px-3 py-2.5 [&+&]:border-t [&+&]:border-separator">
      <Icon size={16} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium text-foreground">{t(item.titleKey)}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{t(item.commandKey)}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{t(item.bodyKey)}</p>
      </div>
      <Badge variant={item.badgeVariant}>{t(item.badgeKey)}</Badge>
    </li>
  )
}
