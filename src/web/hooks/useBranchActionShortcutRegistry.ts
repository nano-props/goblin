import { useEffect, useRef } from 'react'
import { type BranchActionItemGroups, visibleBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { setBranchActionShortcutHandler } from '#/web/keyboard/branch-action-shortcuts.ts'

export function useBranchActionShortcutRegistry(actions: BranchActionItemGroups): void {
  const visibleItems = visibleBranchActionItems(actions)
  const visibleItemsRef = useRef(visibleItems)
  visibleItemsRef.current = visibleItems

  useEffect(() => {
    return setBranchActionShortcutHandler((action) => {
      const item = visibleItemsRef.current.find((candidate) => candidate.id === action)
      if (!item || item.disabled) return
      void item.onSelect()
    })
  }, [])
}
