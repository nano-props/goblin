# Terminal Ephemeral Xterm Memo

Use this memo for the long-term option of removing live xterm DOM from inactive
terminal tabs.

## Current Model

Inactive terminals keep their xterm DOM alive in a parking root. This makes tab
switching instant, but hidden xterms can still receive realtime output. That is
correct only if the parked container preserves the same geometry xterm was
fitted against.

For the current reverse-video `%` bug, preserving parking geometry is the right
small fix because it restores that missing invariant without changing terminal
lifecycle semantics.

## Candidate Model

Inactive terminals would not keep a live xterm DOM.

- Server owns session lifecycle, PTY state, control state, and render snapshots.
- Client projection owns selection, activity, bell state, and metadata.
- Only the selected terminal owns a mounted xterm.
- Selecting a terminal measures the visible host, attaches with those
  `cols`/`rows`, receives a snapshot, then paints xterm.
- Deselecting destroys or serializes the xterm; later output updates server
  render state, not hidden DOM.

## Tradeoff

This is cleaner architecturally and removes hidden-layout correctness from the
rendering model, but it can make tab switching visibly slower:

`select -> measure -> create xterm -> attach -> snapshot -> write snapshot`

Large snapshots, slow xterm writes, busy main-thread work, or WebSocket
reconnects can create a blank frame or flash. If we need warm caches, previews,
grace windows, and streaming writes to hide that cost, the design may not be
simpler than the parking model.

## Notes

React `Activity` is relevant as a conceptual model for hidden UI with cleaned-up
effects, but xterm is imperative and geometry-sensitive, so it should not be
adopted blindly.

CSS containment helps make parked DOM cheaper and safer, but it does not remove
the need for correct terminal geometry. Terminal columns are semantic.

## Recommendation

Do not use ephemeral inactive xterms as a narrow bug fix. Treat it as a separate
terminal lifecycle project, gated by switch-latency metrics and visual stability
testing.
