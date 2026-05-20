import { Loader2 } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useReposStore, type RepoState, type DetailTab } from '#/renderer/stores/repos.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { BranchActionBar } from '#/renderer/components/BranchActionBar.tsx'
import { Toolbar } from '#/renderer/components/Layout.tsx'
import { useGhosttyInstalled } from '#/renderer/hooks/useGhosttyInstalled.ts'
import { useVSCodeInstalled } from '#/renderer/hooks/useVSCodeInstalled.ts'
import { cn } from '#/renderer/lib/cn.ts'
import type { SelectedBranchDetail } from '#/renderer/components/branch-detail/model.ts'

interface Props {
  repo: RepoState
  detail: SelectedBranchDetail
  detailId: string
}

const DETAIL_TABS: { id: DetailTab; key: string }[] = [
  { id: 'status', key: 'tab.status' },
  { id: 'commits', key: 'tab.log' },
]

export function BranchDetailToolbar({ repo, detail, detailId }: Props) {
  const t = useT()
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const ghosttyInstalled = useGhosttyInstalled()
  const vscodeInstalled = useVSCodeInstalled()

  if (!detail.branch) return null

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, tabId: DetailTab) {
    const current = DETAIL_TABS.findIndex((tab) => tab.id === tabId)
    const last = DETAIL_TABS.length - 1
    const next =
      e.key === 'ArrowRight'
        ? (current + 1) % DETAIL_TABS.length
        : e.key === 'ArrowLeft'
          ? (current - 1 + DETAIL_TABS.length) % DETAIL_TABS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1
    if (next === -1) return
    e.preventDefault()
    const nextTab = DETAIL_TABS[next]
    setDetailTab(repo.id, nextTab.id)
    window.requestAnimationFrame(() => document.getElementById(`${detailId}-${nextTab.id}-tab`)?.focus())
  }

  return (
    <Toolbar variant="detail">
      <div className="flex shrink-0" role="tablist" aria-label={t('tab.branchDetail')}>
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab.id}
            id={`${detailId}-${tab.id}-tab`}
            type="button"
            role="tab"
            aria-selected={repo.detailTab === tab.id}
            aria-controls={`${detailId}-${tab.id}-panel`}
            tabIndex={repo.detailTab === tab.id ? 0 : -1}
            onClick={() => setDetailTab(repo.id, tab.id)}
            onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
            className={cn(
              'h-9 px-3 text-sm border-b-2 -mb-px cursor-pointer transition-colors duration-100',
              repo.detailTab === tab.id
                ? 'border-brand text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(tab.key)}
            {tab.id === 'status' && detail.statusCount > 0 && (
              <Badge variant="warning" className="ml-1.5 rounded-full">
                {detail.statusCount}
              </Badge>
            )}
            {tab.id === 'commits' && detail.branchLog?.loading && (
              <Loader2 size={11} className="ml-1.5 inline animate-spin text-muted-foreground" />
            )}
          </button>
        ))}
      </div>
      <BranchActionBar
        key={`${repo.id}:${detail.branch.name}`}
        repo={repo}
        branch={detail.branch}
        ghosttyInstalled={ghosttyInstalled}
        vscodeInstalled={vscodeInstalled}
      />
    </Toolbar>
  )
}
