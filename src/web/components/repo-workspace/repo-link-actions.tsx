import { defineComponent, onScopeDispose } from 'vue'
import type { HTMLAttributes, PropType } from 'vue'
import { throttle } from 'es-toolkit'
import { openRepoUrl } from '#/web/repo-client.ts'
import { StatusLink } from '#/web/components/workspace-pane/status-ui.tsx'
import type { Tone } from '#/web/components/workspace-pane/status-ui.tsx'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

export const CommitHashLink = defineComponent<{
  repoId: string
  workspaceRuntimeId: string
  hash: string
  shortHash?: string
  tone?: Tone
  title?: string
  class?: HTMLAttributes['class']
}>({
  name: 'CommitHashLink',
  inheritAttrs: false,
  props: {
    repoId: { type: String, required: true },
    workspaceRuntimeId: { type: String, required: true },
    hash: { type: String, required: true },
    shortHash: String,
    tone: String as PropType<Tone>,
    title: String,
    class: null,
  },

  setup(props, { attrs }) {
    const controller = new AbortController()
    const handleClick = throttle(
      () => {
        const repoId = canonicalWorkspaceLocator(props.repoId)
        if (!repoId) return
        void openRepoUrl(repoId, props.workspaceRuntimeId, { type: 'commit', hash: props.hash }).catch(() => {})
      },
      500,
      { edges: ['leading'], signal: controller.signal },
    )
    onScopeDispose(() => controller.abort('commit-hash-link-unmounted'))

    return () => (
      <StatusLink {...attrs} mono tone={props.tone} title={props.title} onClick={handleClick} class={props.class}>
        {props.shortHash || props.hash.slice(0, 7)}
      </StatusLink>
    )
  },
})
