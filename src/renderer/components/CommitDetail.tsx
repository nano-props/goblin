// Commit detail pane — shown in the detail section when the user picks
// a commit. Header (subject + body + author + date + parents) on top,
// numstat-derived file list below. Press Esc or click the back chevron
// to dismiss.

import { useEffect } from 'react'
import { ArrowLeft, FileText, FileWarning } from 'lucide-react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useI18nStore, useT } from '#/renderer/stores/i18n.ts'
import { formatRelativeTime } from '#/renderer/lib/dates.ts'
import { FilePathText } from '#/renderer/components/FilePathText.tsx'
import { ScrollArea } from '#/renderer/components/ui/scroll-area.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { isShortcutBlockingLayerOpen } from '#/renderer/lib/layers.ts'
import type { CommitDetail as CommitDetailType } from '#/shared/rpc.ts'

interface Props {
  repoId: string
  detail: CommitDetailType
}

export function CommitDetail({ repoId, detail }: Props) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const closeCommit = useReposStore((s) => s.closeCommit)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Don't fight a Radix layer (Settings / Help / push confirm /
      // dropdown menu) — it owns Escape while open. Without this gate,
      // pressing Esc with a modal open would close BOTH the modal and
      // the commit detail at once.
      if (isShortcutBlockingLayerOpen()) return
      closeCommit(repoId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [repoId, closeCommit])

  const { meta, files } = detail
  const totalAdded = files.reduce((n, f) => n + f.added, 0)
  const totalDeleted = files.reduce((n, f) => n + f.deleted, 0)
  const maxFileChanges = files.reduce((max, f) => Math.max(max, f.added + f.deleted), 1)

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex items-start gap-3 border-b border-separator bg-muted px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => closeCommit(repoId)}
          className="mt-0.5 shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          aria-label={t('error.back')}
          title={t('error.back')}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-xs text-brand-text shrink-0">{meta.shortHash}</span>
            <span className="text-sm font-semibold text-foreground">{meta.subject}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {meta.author} &lt;{meta.email}&gt; · {formatRelativeTime(meta.date, lang)}
          </div>
          {meta.parents.length > 0 && (
            <div className="mt-0.5 text-xs text-muted-foreground font-mono">
              {meta.parents.length > 1 ? t('commit.parents') : t('commit.parent')}:{' '}
              {meta.parents.map((p) => p.slice(0, 7)).join(', ')}
            </div>
          )}
          {meta.body && (
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs text-foreground leading-relaxed">
              {meta.body}
            </pre>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 border-b border-separator bg-card px-4 py-1.5 text-xs text-muted-foreground">
        <span>
          {t(files.length === 1 ? 'commit.files-changed' : 'commit.files-changed-plural', { n: files.length })}
        </span>
        {totalAdded > 0 && <span className="text-success">+{totalAdded}</span>}
        {totalDeleted > 0 && <span className="text-danger">−{totalDeleted}</span>}
      </div>

      {files.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">{t('commit.empty')}</div>
      ) : (
        <ul className="divide-y divide-separator">
          {files.map((f) => (
            <li key={f.path} className="flex items-center gap-3 px-4 py-2">
              <span className="shrink-0 text-muted-foreground">
                {f.binary ? <FileWarning size={14} /> : <FileText size={14} />}
              </span>
              <FilePathText path={f.path} />
              <span className="shrink-0 font-mono text-xs">
                {f.binary ? (
                  <span className="text-muted-foreground">{t('commit.binary')}</span>
                ) : (
                  <>
                    <span className="text-success">+{f.added}</span> <span className="text-danger">−{f.deleted}</span>
                    <span
                      className="ml-2 inline-block h-1.5 rounded-sm align-middle"
                      style={{
                        width: `${Math.min(60, Math.max(2, ((f.added + f.deleted) / maxFileChanges) * 60))}px`,
                        background: `linear-gradient(to right, var(--color-success) ${
                          f.added + f.deleted === 0 ? 50 : (f.added / (f.added + f.deleted)) * 100
                        }%, var(--color-danger) 0%)`,
                      }}
                    />
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ScrollArea>
  )
}
