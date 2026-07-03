# Workspace tab opener

Each workspace pane tab may carry an **opener** — the tab that was active when the user triggered the action that opened it. Opener drives two things: where the new tab lands, and which tab gets focus when this one is closed.

## Open

The strip splits based on **how** the action was triggered:

- **From inside a tab** (links in Status, Files tree double-click, `g` commands from a terminal, etc.) → new tab lands **immediately to the right of the opener**.
- **From a generic entry** (`+` button, branch navigator, command palette "Show …", empty-state CTA) → new tab **appends to the end**. Opener is still recorded — it's the tab active at click time — but the new tab does not displace anything.

The opener is captured at click time and does not change afterwards.

## Close

When closing a tab with an opener:

1. If the opener is still in the strip, focus returns to it.
2. Otherwise, focus falls back to the right neighbour.

## Edge cases

- **Opener closed mid-flight** → open path appends to end; close path uses the right neighbour.
- **Opener in a different branch** → opener is only used if it actually exists in the target strip; otherwise falls back to append / right neighbour.
- **No active tab** (cold start, empty strip) → opener is null; new tab is appended.