import { useMemo, type ComponentProps } from 'react'
import { throttle } from 'es-toolkit'
import { openRepoUrl } from '#/web/repo-client.ts'
import { StatusLink, type Tone } from '#/web/components/repo-workspace/status-ui.tsx'

type CommitHashLinkProps = Omit<ComponentProps<'button'>, 'type' | 'children' | 'onClick'> & {
  repoId: string
  workspaceRuntimeId: string
  hash: string
  shortHash?: string
  tone?: Tone
}

export function CommitHashLink({ repoId, workspaceRuntimeId, hash, shortHash, tone, title, className, ...props }: CommitHashLinkProps) {
  const handleClick = useMemo(
    () =>
      throttle(
        () => {
          void openRepoUrl(repoId, workspaceRuntimeId, { type: 'commit', hash }).catch(() => {})
        },
        500,
        { edges: ['leading'] },
      ),
    [repoId, workspaceRuntimeId, hash],
  )

  return (
    <StatusLink mono tone={tone} title={title} onClick={handleClick} className={className} {...props}>
      {shortHash || hash.slice(0, 7)}
    </StatusLink>
  )
}
