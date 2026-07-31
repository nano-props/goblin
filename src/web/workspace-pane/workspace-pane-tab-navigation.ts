import { workspacePaneTabEntryIdentity, type WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import {
  isMaterializedWorkspacePaneTab,
  type WorkspacePaneMaterializedTab,
  type WorkspacePaneTab,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'

export function nextWorkspacePaneTabEntryAfterClose(
  entries: readonly WorkspacePaneTabEntry[],
  closingIdentity: string,
  openerIdentity?: string | null,
): WorkspacePaneTabEntry | null {
  const index = entries.findIndex((entry) => workspacePaneTabEntryIdentity(entry) === closingIdentity)
  if (index === -1) return null
  if (openerIdentity) {
    const opener = entries.find((entry) => workspacePaneTabEntryIdentity(entry) === openerIdentity)
    if (opener) return opener
  }
  return entries[index + 1] ?? entries[index - 1] ?? null
}

export function adjacentWorkspacePaneTab(
  tabs: readonly WorkspacePaneTab[],
  activeIdentity: string | null | undefined,
  direction: 1 | -1,
): WorkspacePaneMaterializedTab | null {
  if (tabs.length === 0) return null
  if (!activeIdentity) return null
  const activeIndex = tabs.findIndex((tab) => tab.identity === activeIdentity)
  if (activeIndex === -1) return null
  for (let offset = 1; offset < tabs.length; offset += 1) {
    const nextIndex = (activeIndex + direction * offset + tabs.length) % tabs.length
    const tab = tabs[nextIndex]
    if (tab && isMaterializedWorkspacePaneTab(tab)) return tab
  }
  return null
}
