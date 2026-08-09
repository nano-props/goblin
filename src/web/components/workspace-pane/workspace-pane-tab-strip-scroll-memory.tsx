import { defineComponent, inject, provide } from 'vue'
import type { InjectionKey } from 'vue'

export interface WorkspacePaneTabStripScrollMemory {
  read(key: string): number | undefined
  write(key: string, scrollLeft: number): void
}

const workspacePaneTabStripScrollMemoryKey: InjectionKey<WorkspacePaneTabStripScrollMemory> = Symbol(
  'workspace-pane-tab-strip-scroll-memory',
)

export const WorkspacePaneTabStripScrollMemoryProvider = defineComponent({
  name: 'WorkspacePaneTabStripScrollMemoryProvider',
  setup(_props, { slots }) {
    provideWorkspacePaneTabStripScrollMemory()
    return () => slots.default?.()
  },
})

export function provideWorkspacePaneTabStripScrollMemory(): void {
  provide(workspacePaneTabStripScrollMemoryKey, createWorkspacePaneTabStripScrollMemory())
}

export function useWorkspacePaneTabStripScrollMemoryController(): WorkspacePaneTabStripScrollMemory {
  const memory = inject(workspacePaneTabStripScrollMemoryKey, null)
  if (!memory) throw new Error('WorkspacePaneTabStripScrollMemoryProvider is required')
  return memory
}

function createWorkspacePaneTabStripScrollMemory(): WorkspacePaneTabStripScrollMemory {
  const positions = new Map<string, number>()
  return {
    read: (key) => positions.get(key),
    write: (key, scrollLeft) => positions.set(key, scrollLeft),
  }
}
