import { Loader2 } from 'lucide-react'
import { RepoActionsHeader } from '#/renderer/components/RepoActionsHeader.tsx'
import { Toolbar, ToolbarTitle } from '#/renderer/components/Layout.tsx'
import { useT } from '#/renderer/stores/i18n.ts'
import { useReposStore } from '#/renderer/stores/repos.ts'
import { tildify } from '#/renderer/lib/paths.ts'

interface Props {
  repoId: string
}

export function RepoToolbar({ repoId }: Props) {
  const repo = useReposStore((s) => s.repos[repoId])
  const t = useT()
  if (!repo) return null

  const status = (
    <>
      {repo.fetching && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground" title={t('tab.fetchingTitle')}>
          <Loader2 size={12} className="animate-spin" />
          {t('tab.fetching')}
        </span>
      )}
      {!repo.fetching && repo.fetchFailed && (
        <span
          className="flex items-center gap-1 text-xs text-warning"
          // Hover surfaces the actual git error (e.g. "fatal: could
          // not read Username") so the user can act on it; without
          // a real message we fall back to the generic title.
          title={repo.fetchError ?? t('tab.fetchFailedTitle')}
          aria-label={repo.fetchError ?? t('tab.fetchFailedTitle')}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-warning" />
          {t('tab.fetchFailed')}
        </span>
      )}
    </>
  )

  return (
    <Toolbar variant="repo">
      <ToolbarTitle title={repo.name} description={tildify(repo.id)} after={status} />
      <RepoActionsHeader repo={repo} />
    </Toolbar>
  )
}
