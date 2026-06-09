import { ExternalLink, Hash, Tag } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { GitHubMark } from '#/web/components/GitHubMark.tsx'
import { SettingsCard, SettingsListItem } from '#/web/components/settings/SettingsPrimitives.tsx'
import { useAboutSettingsController } from '#/web/runtime-settings-about.ts'
import { useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'
const appIconUrl = new URL('../../../../../assets/icon.png', import.meta.url).href

export function AboutSettings() {
  const t = useT()
  const commit = __BUILD_INFO__.commit
  const { openProjectGitHub } = useAboutSettingsController()

  return (
    <SettingsCard as="ul">
      <SettingsListItem as="li" size="xl">
        <img src={appIconUrl} alt="Goblin" className="size-8 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-foreground">{t('about.app')}</span>
        </div>
      </SettingsListItem>
      <SettingsListItem as="li" size="xl">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Tag size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-foreground">{t('about.version')}</span>
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">v{__APP_VERSION__}</span>
      </SettingsListItem>
      <SettingsListItem as="li" size="xl">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Hash size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-foreground">{t('about.build')}</span>
        </div>
        <span className={cn('shrink-0 text-xs text-muted-foreground', commit ? 'font-mono' : 'font-sans')}>
          {commit || t('about.build.unknown')}
        </span>
      </SettingsListItem>
      <SettingsListItem as="li" size="xl">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <GitHubMark className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-foreground">{t('about.github')}</span>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{t('about.github.body')}</p>
        </div>
        <Button
          type="button"
          data-interactive
          variant="ghost"
          size="icon-lg"
          onClick={() => void openProjectGitHub()}
          className="shrink-0 text-muted-foreground hover:text-accent-foreground"
          aria-label={t('settings.open-github')}
        >
          <ExternalLink className="size-3.5" />
        </Button>
      </SettingsListItem>
    </SettingsCard>
  )
}
