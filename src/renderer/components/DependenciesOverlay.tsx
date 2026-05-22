import { Code2, GitBranch, GitPullRequest, Terminal } from 'lucide-react'
import { Modal } from '#/renderer/components/Modal.tsx'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { useT } from '#/renderer/stores/i18n.ts'
import type { BadgeVariant } from '#/renderer/components/ui/badge.tsx'

interface Props {
  open: boolean
  onClose: () => void
}

const DEPENDENCIES = [
  {
    id: 'git',
    Icon: GitBranch,
    badgeVariant: 'warning',
    badgeKey: 'dependencies.required',
    titleKey: 'dependencies.git.title',
    commandKey: 'dependencies.git.command',
    bodyKey: 'dependencies.git.body',
  },
  {
    id: 'gh',
    Icon: GitPullRequest,
    badgeVariant: 'brand',
    badgeKey: 'dependencies.optional',
    titleKey: 'dependencies.gh.title',
    commandKey: 'dependencies.gh.command',
    bodyKey: 'dependencies.gh.body',
  },
  {
    id: 'ghostty',
    Icon: Terminal,
    badgeVariant: 'brand',
    badgeKey: 'dependencies.optional',
    titleKey: 'dependencies.ghostty.title',
    commandKey: 'dependencies.ghostty.command',
    bodyKey: 'dependencies.ghostty.body',
  },
  {
    id: 'vscode',
    Icon: Code2,
    badgeVariant: 'brand',
    badgeKey: 'dependencies.optional',
    titleKey: 'dependencies.vscode.title',
    commandKey: 'dependencies.vscode.command',
    bodyKey: 'dependencies.vscode.body',
  },
] satisfies {
  id: string
  Icon: typeof GitBranch
  badgeVariant: BadgeVariant
  badgeKey: string
  titleKey: string
  commandKey: string
  bodyKey: string
}[]

export function DependenciesOverlay({ open, onClose }: Props) {
  const t = useT()
  return (
    <Modal open={open} title={t('dependencies.title')} onClose={onClose} widthClass="sm:max-w-2xl">
      <div className="space-y-3">
        <ul className="grid gap-2 sm:grid-cols-2">
          {DEPENDENCIES.map((dependency) => (
            <DependencyCard key={dependency.id} dependency={dependency} />
          ))}
        </ul>
        <p className="pt-0.5 text-[11px] leading-snug text-muted-foreground/75">{t('dependencies.intro')}</p>
      </div>
    </Modal>
  )
}

function DependencyCard({ dependency }: { dependency: (typeof DEPENDENCIES)[number] }) {
  const t = useT()
  const Icon = dependency.Icon
  return (
    <li className="min-w-0 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground shadow-sm ring-1 ring-border/60">
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">{t(dependency.titleKey)}</span>
            <Badge variant={dependency.badgeVariant}>{t(dependency.badgeKey)}</Badge>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{t(dependency.commandKey)}</div>
        </div>
      </div>
      <p className="mt-2 text-xs leading-snug text-muted-foreground" title={t(dependency.bodyKey)}>
        {t(dependency.bodyKey)}
      </p>
    </li>
  )
}
