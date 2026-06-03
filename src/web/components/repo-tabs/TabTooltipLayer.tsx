import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '#/web/lib/cn.ts'
import { DelegatedTooltipLayer, DELEGATED_TOOLTIP_DEFAULTS } from '#/web/components/DelegatedTooltipLayer.tsx'
import { formatRepoLocator } from '#/web/lib/paths.ts'
import type { RepoTabSummary } from '#/web/components/repo-tabs/types.ts'
import { TOOLTIP_META_TEXT_CLASS, TOOLTIP_STACK_MD_CLASS, TOOLTIP_STACK_SM_CLASS } from '#/web/components/ui/tooltip.tsx'
import { useT } from '#/web/stores/i18n.ts'

interface TabTooltipLayerProps extends ComponentPropsWithoutRef<'div'> {
  repos: RepoTabSummary[]
  delayMs?: number
}

const TAB_TOOLTIP_SELECTOR = '[data-repo-tab-tooltip-id]'

export function TabTooltipLayer({ repos, delayMs = DELEGATED_TOOLTIP_DEFAULTS.delayMs, children, ...props }: TabTooltipLayerProps) {
  return (
    <DelegatedTooltipLayer
      items={repos}
      selector={TAB_TOOLTIP_SELECTOR}
      attributeName="data-repo-tab-tooltip-id"
      getItemId={(repo) => repo.id}
      renderTooltip={(repo) => <RepoTabTooltipContent repo={repo} />}
      delayMs={delayMs}
      placement="bottom-start"
      maxWidth={DELEGATED_TOOLTIP_DEFAULTS.maxWidth}
      tooltipClassName="px-3 py-2"
      {...props}
    >
      {children}
    </DelegatedTooltipLayer>
  )
}

function RepoTabTooltipContent({ repo }: { repo: RepoTabSummary }) {
  const t = useT()
  return (
    <>
      <div className="truncate text-xs font-semibold text-foreground">{repo.name}</div>
      <div className={cn('mt-0.5 truncate font-mono', TOOLTIP_META_TEXT_CLASS)}>
        {formatRepoLocator(repo.id, repo.remoteTarget)}
      </div>
      {repo.remoteDetails.length > 0 && (
        <div className={cn('mt-2 border-t border-border/40 pt-2', TOOLTIP_STACK_MD_CLASS)}>
          {repo.remoteDetails.map((remote) => {
            const sameUrl = remote.fetchUrl === remote.pushUrl
            return sameUrl ? (
              <div key={remote.name} className={cn('flex min-w-0 items-center gap-1.5', TOOLTIP_META_TEXT_CLASS)}>
                <span className="shrink-0 font-mono text-muted-foreground/80">{remote.name}</span>
                <span className="shrink-0 font-mono text-muted-foreground/60" aria-hidden>
                  →
                </span>
                <span className="min-w-0 truncate font-mono text-muted-foreground/80">{remote.fetchUrl}</span>
                <ArrowUpDown size={10} className="shrink-0 text-muted-foreground/60" aria-hidden />
              </div>
            ) : (
              <div key={remote.name} className={cn(TOOLTIP_STACK_SM_CLASS, TOOLTIP_META_TEXT_CLASS)}>
                <div className="font-mono text-muted-foreground/80">{remote.name}</div>
                <div className="flex min-w-0 items-center gap-1 pl-1">
                  <ArrowDown size={10} className="shrink-0 text-muted-foreground/60" aria-hidden />
                  <span className="min-w-0 truncate font-mono text-muted-foreground/80">{remote.fetchUrl}</span>
                </div>
                <div className="flex min-w-0 items-center gap-1 pl-1">
                  <ArrowUp size={10} className="shrink-0 text-muted-foreground/60" aria-hidden />
                  <span className="min-w-0 truncate font-mono text-muted-foreground/80">{remote.pushUrl}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {repo.remoteDetails.length === 0 && (
        <div className={cn('mt-2 border-t border-border/40 pt-2 text-muted-foreground/60', TOOLTIP_META_TEXT_CLASS)}>
          {t('repo-tabs.tooltip.no-remotes')}
        </div>
      )}
    </>
  )
}
