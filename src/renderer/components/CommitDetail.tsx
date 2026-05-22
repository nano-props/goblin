// Commit detail overlay — shown over the Log list when the user picks
// a commit. Header (subject + body + author + date + parents) on top,
// numstat-derived file list below. Press Esc or click the back chevron
// to dismiss.

import { useEffect } from 'react'
import { ArrowLeft, FileText, FileWarning } from 'lucide-react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useI18nStore, useT } from '#/renderer/stores/i18n.ts'
import { formatRelativeTime } from '#/renderer/lib/dates.ts'
import { isShortcutBlockingLayerOpen } from '#/renderer/lib/layers.ts'
import type { CommitDetail as CommitDetailType } from '#/renderer/types-bridge.ts'

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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
      <div className="flex items-start gap-3 border-b border-border bg-muted px-4 py-3">
        <button
          type="button"
          onClick={() => closeCommit(repoId)}
          className="mt-0.5 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground transition-colors duration-100"
          aria-label={t('error.back')}
          title={t('error.back')}
        >
          <ArrowLeft size={16} />
        </button>
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

      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
        <span>
          {t(files.length === 1 ? 'commit.files-changed' : 'commit.files-changed-plural', { n: files.length })}
        </span>
        {totalAdded > 0 && <span className="text-success">+{totalAdded}</span>}
        {totalDeleted > 0 && <span className="text-danger">−{totalDeleted}</span>}
      </div>

      {files.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">{t('commit.empty')}</div>
      ) : (
        <ul className="divide-y divide-border">
          {files.map((f) => (
            <li key={f.path} className="px-4 py-2 flex items-center gap-3">
              <span className="shrink-0 text-muted-foreground">
                {f.binary ? <FileWarning size={14} /> : <FileText size={14} />}
              </span>
              <span className="truncate text-sm text-foreground font-mono flex-1 min-w-0">{f.path}</span>
              <span className="shrink-0 font-mono text-xs">
                {f.binary ? (
                  <span className="text-muted-foreground">{t('commit.binary')}</span>
                ) : (
                  <>
                    <span className="text-success">+{f.added}</span> <span className="text-danger">−{f.deleted}</span>
                    <span
                      className="ml-2 inline-block align-middle h-1.5 rounded-sm"
                      style={{
                        width: `${Math.min(60, Math.max(2, ((f.added + f.deleted) / Math.max(1, ...files.map((x) => x.added + x.deleted))) * 60))}px`,
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
    </div>
  )
}
