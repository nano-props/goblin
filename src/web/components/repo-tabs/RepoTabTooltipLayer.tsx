import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '#/web/lib/cn.ts'
import { DelegatedTooltipLayer, DELEGATED_TOOLTIP_DEFAULTS } from '#/web/components/DelegatedTooltipLayer.tsx'
import { formatRepoLocator } from '#/web/lib/paths.ts'
import { formatRelativeTime } from '#/web/lib/dates.ts'
import { remoteRepoLifecycleTarget } from '#/shared/remote-repo.ts'
import type { RepoTabSummary } from '#/web/components/repo-tabs/types.ts'
import { ToolbarTabList } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { TOOLTIP_STACK_MD_CLASS, TOOLTIP_STACK_SM_CLASS } from '#/web/components/ui/tooltip.tsx'
import { useI18nStore, useT } from '#/web/stores/i18n.ts'

interface RepoTabTooltipLayerProps extends ComponentPropsWithoutRef<'div'> {
  repos: RepoTabSummary[]
  delayMs?: number
}

const REPO_TAB_TOOLTIP_DELAY_MS = 100

const REPO_TAB_TOOLTIP_SELECTOR = '[data-repo-tab-tooltip-id]'
const REPO_TAB_TOOLTIP_META_TEXT_CLASS = 'text-xs leading-4 text-muted-foreground'
const REPO_TAB_TOOLTIP_ICON_CLASS = 'shrink-0 text-muted-foreground/80'

export function RepoTabTooltipLayer({
  repos,
  delayMs = REPO_TAB_TOOLTIP_DELAY_MS,
  children,
  ...props
}: RepoTabTooltipLayerProps) {
  return (
    <DelegatedTooltipLayer
      items={repos}
      selector={REPO_TAB_TOOLTIP_SELECTOR}
      attributeName="data-repo-tab-tooltip-id"
      getItemId={(repo) => repo.id}
      renderTooltip={(repo) => <RepoTabTooltipContent repo={repo} />}
      delayMs={delayMs}
      placement="bottom-start"
      maxWidth={DELEGATED_TOOLTIP_DEFAULTS.maxWidth}
      tooltipClassName="px-3 py-2"
      asChild
    >
      <ToolbarTabList aria-orientation={props.role === 'tablist' ? 'horizontal' : undefined} {...props}>
        {children}
      </ToolbarTabList>
    </DelegatedTooltipLayer>
  )
}

function RepoTabTooltipContent({ repo }: { repo: RepoTabSummary }) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  // The tooltip shows the remote locator (alias@host:path) for
  // ready/failed remote repos with a retained target. Connecting
  // remotes and local repos fall back to a plain repo-id render.
  const remoteTarget = remoteRepoLifecycleTarget(repo.lifecycle)
  const syncedAtDate = repo.lastSyncedAt === null ? null : new Date(repo.lastSyncedAt)
  const syncedAtIso = syncedAtDate?.toISOString() ?? null
  const syncedAtLabel = syncedAtIso ? formatRelativeTime(syncedAtIso, lang) : t('repo-tabs.tooltip.not-synced')
  return (
    <>
      <div className="truncate text-xs font-semibold text-foreground">{repo.name}</div>
      <div className={cn('mt-0.5 truncate font-mono', REPO_TAB_TOOLTIP_META_TEXT_CLASS)}>
        {formatRepoLocator(repo.id, remoteTarget)}
      </div>
      <div className={cn('mt-1 flex min-w-0 items-center gap-1.5', REPO_TAB_TOOLTIP_META_TEXT_CLASS)}>
        <span className="shrink-0">{t('repo-tabs.tooltip.last-sync-label')}</span>
        {syncedAtIso ? (
          <time dateTime={syncedAtIso} title={syncedAtDate?.toLocaleString()} className="min-w-0 truncate">
            {syncedAtLabel}
          </time>
        ) : (
          <span className="min-w-0 truncate">{syncedAtLabel}</span>
        )}
      </div>
      {repo.remoteDetails.length > 0 && (
        <div className={cn('mt-2 border-t border-border/40 pt-2', TOOLTIP_STACK_MD_CLASS)}>
          {repo.remoteDetails.map((remote) => {
            const sameUrl = remote.fetchUrl === remote.pushUrl
            return sameUrl ? (
              <div
                key={remote.name}
                className={cn('flex min-w-0 items-center gap-1.5', REPO_TAB_TOOLTIP_META_TEXT_CLASS)}
              >
                <span className="shrink-0 font-mono">{remote.name}</span>
                <span className={cn('font-mono', REPO_TAB_TOOLTIP_ICON_CLASS)} aria-hidden>
                  →
                </span>
                <span className="min-w-0 truncate font-mono">{remote.fetchUrl}</span>
                <ArrowUpDown size={10} className={REPO_TAB_TOOLTIP_ICON_CLASS} aria-hidden />
              </div>
            ) : (
              <div key={remote.name} className={cn(TOOLTIP_STACK_SM_CLASS, REPO_TAB_TOOLTIP_META_TEXT_CLASS)}>
                <div className="font-mono">{remote.name}</div>
                <div className="flex min-w-0 items-center gap-1 pl-1">
                  <ArrowDown size={10} className={REPO_TAB_TOOLTIP_ICON_CLASS} aria-hidden />
                  <span className="min-w-0 truncate font-mono">{remote.fetchUrl}</span>
                </div>
                <div className="flex min-w-0 items-center gap-1 pl-1">
                  <ArrowUp size={10} className={REPO_TAB_TOOLTIP_ICON_CLASS} aria-hidden />
                  <span className="min-w-0 truncate font-mono">{remote.pushUrl}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {repo.remoteDetails.length === 0 && (
        <div className={cn('mt-2 border-t border-border/40 pt-2', REPO_TAB_TOOLTIP_META_TEXT_CLASS)}>
          {t('repo-tabs.tooltip.no-remotes')}
        </div>
      )}
    </>
  )
}
