import { createContext, useContext, useRef, type ReactNode } from 'react'

export interface WorkspacePaneTabStripScrollMemory {
  read(key: string): number | undefined
  write(key: string, scrollLeft: number): void
}

const WorkspacePaneTabStripScrollMemoryContext = createContext<WorkspacePaneTabStripScrollMemory | null>(null)

export function WorkspacePaneTabStripScrollMemoryProvider({ children }: { children: ReactNode }) {
  const memoryRef = useRef<WorkspacePaneTabStripScrollMemory | null>(null)
  if (!memoryRef.current) memoryRef.current = createWorkspacePaneTabStripScrollMemory()

  return (
    <WorkspacePaneTabStripScrollMemoryContext value={memoryRef.current}>
      {children}
    </WorkspacePaneTabStripScrollMemoryContext>
  )
}

export function useWorkspacePaneTabStripScrollMemoryController(): WorkspacePaneTabStripScrollMemory {
  const inheritedMemory = useContext(WorkspacePaneTabStripScrollMemoryContext)
  const localMemoryRef = useRef<WorkspacePaneTabStripScrollMemory | null>(null)
  if (!localMemoryRef.current) localMemoryRef.current = createWorkspacePaneTabStripScrollMemory()
  return inheritedMemory ?? localMemoryRef.current
}

function createWorkspacePaneTabStripScrollMemory(): WorkspacePaneTabStripScrollMemory {
  const positions = new Map<string, number>()
  return {
    read: (key) => positions.get(key),
    write: (key, scrollLeft) => positions.set(key, scrollLeft),
  }
}
