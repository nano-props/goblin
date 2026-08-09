import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { EmptyState } from '#/web/components/Layout.tsx'
import { FilePathText } from '#/web/components/FilePathText.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'
import type { StatusEntry, WorktreeStatus } from '#/shared/git-types.ts'

interface Props {
  status: WorktreeStatus[]
  emptyTitleKey?: string
  emptyBodyKey?: string
}

function isUnmergedStatus(entry: StatusEntry): boolean {
  return entry.x === 'U' || entry.y === 'U' || (entry.x === entry.y && (entry.x === 'A' || entry.x === 'D'))
}

function statusCodeClass(entry: StatusEntry, column: 'x' | 'y'): string {
  const code = column === 'x' ? entry.x : entry.y
  if (code === ' ' || !code) return 'text-transparent'
  if (code === '!') return 'text-muted-foreground'
  if (code === '?' || isUnmergedStatus(entry)) return 'text-danger'
  return column === 'x' ? 'text-success' : 'text-danger'
}

function StatusCode({ entry }: { entry: StatusEntry }) {
  return (
    <span
      class="inline-grid w-[2ch] shrink-0 grid-cols-[1ch_1ch] font-mono text-sm leading-none"
      aria-label={`${entry.x}${entry.y}`}
    >
      <span class={statusCodeClass(entry, 'x')}>{entry.x === ' ' ? '\u00a0' : entry.x}</span>
      <span class={statusCodeClass(entry, 'y')}>{entry.y === ' ' ? '\u00a0' : entry.y}</span>
    </span>
  )
}

export const StatusList = defineComponent<Props>({
  name: 'StatusList',
  props: {
    status: { type: Array as PropType<WorktreeStatus[]>, required: true },
    emptyTitleKey: String,
    emptyBodyKey: String,
  },

  setup(props) {
    const t = useT()
    return () => {
      const emptyTitleKey = props.emptyTitleKey ?? 'status.clean-title'
      const emptyBodyKey = props.emptyBodyKey ?? 'status.clean-body'
      const totalEntries = props.status.reduce((count, worktree) => count + worktree.entries.length, 0)
      const dirtyWorktrees = props.status.filter((worktree) => worktree.entries.length > 0)

      if (totalEntries === 0) {
        return <EmptyState icon="✓" title={t(emptyTitleKey)} body={t(emptyBodyKey)} tone="success" />
      }

      return (
        <>
          {dirtyWorktrees.map((worktree) => (
            <ul key={worktree.path} class="py-1.5 tracking-wider" style={{ fontFamily: 'var(--font-mono)' }}>
              {worktree.entries.map((entry) => (
                <li
                  key={`${worktree.path}-${entry.path}`}
                  class="grid grid-cols-[2ch_minmax(0,1fr)] items-center gap-3 px-1.5"
                >
                  <StatusCode entry={entry} />
                  <FilePathText path={entry.path} />
                </li>
              ))}
            </ul>
          ))}
        </>
      )
    }
  },
})
