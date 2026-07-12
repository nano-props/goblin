import { useMemo, type ComponentProps } from 'react'
import { throttle } from 'es-toolkit'
import { openRepoUrl } from '#/web/repo-client.ts'
import { StatusLink, type Tone } from '#/web/components/repo-workspace/status-ui.tsx'

type CommitHashLinkProps = Omit<ComponentProps<'button'>, 'type' | 'children' | 'onClick'> & {
  repoId: string
  repoRuntimeId: string
  hash: string
  shortHash?: string
  tone?: Tone
}

export function CommitHashLink({ repoId, repoRuntimeId, hash, shortHash, tone, title, className, ...props }: CommitHashLinkProps) {
  const handleClick = useMemo(
    () =>
      throttle(
        () => {
          void openRepoUrl(repoId, repoRuntimeId, { type: 'commit', hash }).catch(() => {})
        },
        500,
        { edges: ['leading'] },
      ),
    [repoId, repoRuntimeId, hash],
  )

  return (
    <StatusLink mono tone={tone} title={title} onClick={handleClick} className={className} {...props}>
      {shortHash || hash.slice(0, 7)}
    </StatusLink>
  )
}
