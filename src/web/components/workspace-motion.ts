import type { CSSProperties } from 'react'

export const WORKSPACE_PANE_TRANSITION_MS = 240
const WORKSPACE_PANE_TRANSITION_EASING = 'cubic-bezier(0.2, 0, 0, 1)'

export const WORKSPACE_PANE_MOTION_STYLE = {
  '--goblin-workspace-pane-transition-duration': `${WORKSPACE_PANE_TRANSITION_MS}ms`,
  '--goblin-workspace-pane-transition-easing': WORKSPACE_PANE_TRANSITION_EASING,
} as CSSProperties
