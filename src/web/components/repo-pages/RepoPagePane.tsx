import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { RepoPageToolbar } from '#/web/components/repo-pages/RepoPageToolbar.tsx'
import { ScrollPane } from '#/web/components/Layout.tsx'
import { Skeleton } from '#/web/components/ui/skeleton.tsx'

interface RepoPagePaneProps {
  icon: LucideIcon
  label: string
  compact?: boolean
  trafficLightOffset?: boolean
  onBack?: () => void
  children: ReactNode
}

export function RepoPagePane({
  icon,
  label,
  compact = false,
  trafficLightOffset = false,
  onBack,
  children,
}: RepoPagePaneProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <RepoPageToolbar
        icon={icon}
        label={label}
        compact={compact}
        trafficLightOffset={trafficLightOffset}
        onBack={onBack}
      />
      {children}
    </section>
  )
}

export function RepoPageLoadingBody() {
  return (
    <ScrollPane>
      <div data-testid="repo-page-loading" className="w-full p-4" aria-busy="true">
        <div className="space-y-4">
          <Skeleton className="h-6 w-40" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-7 w-24" />
          </div>
        </div>
      </div>
    </ScrollPane>
  )
}
