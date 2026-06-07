# Android Terminal Fit Width Fill Design

## Problem

Android terminal `fit to screen width` mode can leave a visible blank strip on the right side of the terminal viewport. The Compose container fills the available width, but the terminal grid is sized with integer columns derived from measured cell width. Any remaining pixels after `width / cellWidth` are not allocated to terminal cells, so the rendered content can stop before the screen edge.

## Goal

In `fit to screen width` mode, the terminal drawing should visually fill the available screen width with no right-side blank strip.

## Non-Goals

- Do not change `Original width` mode behavior.
- Do not remove horizontal drag support in `Original width` mode.
- Do not change SSH connection, terminal input, scrollback, reconnect, or Termux handoff behavior.
- Do not introduce font scaling that visually compresses terminal text.

## Recommended Approach

Use a fit-mode-specific cell layout calculation.

The terminal should keep the current conservative column count calculation, then derive a render cell width that distributes the remaining pixels across the visible grid. In practice:

1. Measure the base terminal cell width from `TerminalRenderer`.
2. Apply the existing terminal cell width adjustment.
3. Compute the terminal grid column count from the available viewport width.
4. In `fit to screen width` mode, compute an effective render scale from `viewportWidth / (columns * rendererFontWidth)` so the final rendered column reaches the right edge.
5. In `Original width` mode, keep the existing fixed-width rendering and horizontal drag behavior.

Termux `TerminalRenderer` does not expose a custom render cell width, so the effective width is applied as a fit-mode-only horizontal canvas scale. The scale must never be less than `1f`; it may expand the terminal slightly to consume the blank strip, but it must not compress the font.

## Components

- `AndroidTerminalViewport`
  - Passes the current width mode into `GoblinTerminalView`.
  - Keeps the existing `Original width` scroll container unchanged.

- `GoblinTerminalView`
  - Tracks whether it is in fit mode.
  - Uses normal measured cell metrics for grid sizing.
  - Uses an adjusted render scale only when fit mode is active.
  - Invalidates/recomputes grid when width mode or font size changes.

- Layout helper functions
  - Add a pure helper for fit-mode effective render scale.
  - Keep existing grid-size helper behavior unless the implementation needs a narrow signature extension.

## Data Flow

1. User selects `Fit to screen width`.
2. Compose lays out the Android terminal view at the available width.
3. `GoblinTerminalView` computes terminal rows and columns.
4. The remote terminal is resized to that grid.
5. Rendering uses a fit-mode effective horizontal scale so the visible terminal grid covers the full view width.

When the user selects `Original width`, the terminal view keeps the fixed expanded content width and the existing horizontal drag logic.

## Error Handling

- Width, height, and cell metrics should be clamped to safe minimums as they are today.
- If the view has not been measured yet, existing no-op behavior should remain.
- Mode changes should reset invalid layout state without affecting the active terminal session.

## Testing

Add focused JVM tests for layout helpers:

- Fit mode fills available width when measured renderer width leaves a right-side blank strip.
- Fit mode render scale is never below `1f`, so text is not compressed.
- Fit mode does not increase reported columns beyond the existing grid calculation.
- Original width mode keeps the existing fixed-width behavior.
- Font-size and small-width minimum clamping still pass existing layout tests.

Run:

- `./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.GoblinTerminalViewLayoutTest"`
- `./gradlew ":app:testDebugUnitTest" ":app:assembleDebug"`

## Scope

This change should stay within Android terminal viewport/layout code and its focused tests:

- `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/AndroidTerminalViewport.kt`
- `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt`
- `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalViewLayoutTest.kt`
