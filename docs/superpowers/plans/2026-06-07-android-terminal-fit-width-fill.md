# Android Terminal Fit Width Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Android terminal `fit to screen width` mode visually fill the full viewport width without changing `Original width` horizontal drag behavior.

**Architecture:** Keep the existing terminal grid sizing conservative, then derive a fit-mode-only horizontal render scale from the viewport width, grid column count, and renderer font width. `AndroidTerminalViewport` owns the width mode and passes it to `GoblinTerminalView`; `GoblinTerminalView` owns terminal grid math and drawing. No SSH/session/input behavior changes.

**Tech Stack:** Android Kotlin, Jetpack Compose `AndroidView`, Termux `TerminalRenderer`, JVM unit tests with JUnit.

**Repository Note:** Do not commit during execution unless the user explicitly asks. This overrides the generic plan template's frequent-commit guidance.

---

## File Structure

- Modify: `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalViewLayoutTest.kt`
  - Adds red tests for fit-mode render scale and original-width preservation.

- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt`
  - Adds a small pure helper for render scale.
  - Tracks fit mode in the View.
  - Applies a fit-mode-only horizontal canvas scale during rendering. The scale is never below `1f`, so it cannot compress the terminal font.
  - Recomputes layout when fit mode changes.

- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/AndroidTerminalViewport.kt`
  - Passes `fitToScreen` into `GoblinTerminalView`.

---

### Task 1: Add Layout Helper Tests

**Files:**
- Modify: `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalViewLayoutTest.kt`

- [ ] **Step 1: Write failing tests for fit-mode fill math**

Append these tests after `grid size uses adjusted cell width to reduce visual density`:

```kotlin
    @Test
    fun `fit render scale fills available viewport width`() {
        val grid = terminalGridSize(
            widthPx = 360,
            heightPx = 540,
            cellWidthPx = terminalCellWidthPx(measuredFontWidthPx = 8f),
            cellHeightPx = 18,
        )

        val renderScale = terminalRenderScaleX(
            widthPx = 360,
            gridColumns = grid.columns,
            measuredFontWidthPx = 8f,
            fitToScreen = true,
        )

        assertEquals(40, grid.columns)
        assertEquals(1.125f, renderScale, 0.001f)
        assertEquals(360f, 8f * renderScale * grid.columns, 0.001f)
    }

    @Test
    fun `fit render scale does not increase terminal grid columns`() {
        val grid = terminalGridSize(
            widthPx = 360,
            heightPx = 540,
            cellWidthPx = terminalCellWidthPx(measuredFontWidthPx = 8f),
            cellHeightPx = 18,
        )

        assertEquals(
            40,
            grid.columns,
        )
    }

    @Test
    fun `original width render scale keeps measured renderer width`() {
        assertEquals(
            1f,
            terminalRenderScaleX(
                widthPx = 360,
                gridColumns = 40,
                measuredFontWidthPx = 8f,
                fitToScreen = false,
            ),
            0.001f,
        )
    }

    @Test
    fun `fit render scale never compresses terminal text`() {
        assertEquals(
            1f,
            terminalRenderScaleX(
                widthPx = 300,
                gridColumns = 40,
                measuredFontWidthPx = 8f,
                fitToScreen = true,
            ),
            0.001f,
        )
    }
```

- [ ] **Step 2: Run tests and verify expected failure**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.GoblinTerminalViewLayoutTest"
```

Expected: compile failure with `Unresolved reference 'terminalRenderScaleX'`.

---

### Task 2: Implement Fit-Mode Render Scale

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt`

- [ ] **Step 1: Add the pure helper**

Add this helper after `terminalCellWidthPx`:

```kotlin
internal fun terminalRenderScaleX(
    widthPx: Int,
    gridColumns: Int,
    measuredFontWidthPx: Float,
    fitToScreen: Boolean,
): Float {
    if (!fitToScreen) return 1f
    val safeMeasuredWidth = measuredFontWidthPx.coerceAtLeast(1f)
    val safeColumns = gridColumns.coerceAtLeast(1)
    val renderedWidth = safeMeasuredWidth * safeColumns
    return (widthPx.toFloat() / renderedWidth).coerceAtLeast(1f)
}
```

- [ ] **Step 2: Run helper tests and verify they pass**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.GoblinTerminalViewLayoutTest"
```

Expected: PASS for the new helper tests and existing layout tests.

- [ ] **Step 3: Add fit mode state to `GoblinTerminalView`**

In `GoblinTerminalView`, add a field near `currentFontSizeSp`:

```kotlin
    private var fitToScreen = true
```

Add this public setter after `setHorizontalViewportWidthPx`:

```kotlin
    fun setFitToScreen(nextFitToScreen: Boolean) {
        if (fitToScreen == nextFitToScreen) return
        fitToScreen = nextFitToScreen
        lastGrid = null
        setHorizontalOffset(horizontalOffset(deltaPx = 0))
        updateGrid(width, height)
        invalidate()
    }
```

- [ ] **Step 4: Apply fit-mode drawing scale in `onDraw`**

Replace the current `onDraw` body:

```kotlin
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val activeController = controller ?: return
        val checkpoint = canvas.save()
        canvas.translate(-horizontalOffsetPx.toFloat(), 0f)
        renderer.render(activeController.emulator, canvas, -scrollbackOffsetRows, -1, -1, -1, -1)
        canvas.restoreToCount(checkpoint)
    }
```

with:

```kotlin
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val activeController = controller ?: return
        val grid = lastGrid
        val horizontalScale = terminalRenderScaleX(
            widthPx = width,
            gridColumns = grid?.columns ?: activeController.emulator.mColumns,
            measuredFontWidthPx = renderer.fontWidth,
            fitToScreen = fitToScreen,
        )
        val checkpoint = canvas.save()
        canvas.translate(-horizontalOffsetPx.toFloat(), 0f)
        if (fitToScreen && horizontalScale != 1f) {
            canvas.scale(horizontalScale, 1f)
        }
        renderer.render(activeController.emulator, canvas, -scrollbackOffsetRows, -1, -1, -1, -1)
        canvas.restoreToCount(checkpoint)
    }
```

Important: keep the scale fit-mode-only and never below `1f`. `Original width` must draw with the existing measured renderer width.

- [ ] **Step 5: Run layout tests**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.GoblinTerminalViewLayoutTest"
```

Expected: PASS.

---

### Task 3: Wire Fit Mode From Compose Into The View

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/AndroidTerminalViewport.kt`

- [ ] **Step 1: Pass `fitToScreen` into `GoblinTerminalView` factory**

In the `AndroidView(factory = { ... })` block, update the `GoblinTerminalView(context).apply { ... }` calls to include `setFitToScreen(fitToScreen)` before binding:

```kotlin
                        GoblinTerminalView(context).apply {
                            setHorizontalViewportWidthPx(horizontalViewportWidthPx)
                            setFitToScreen(fitToScreen)
                            setFontSizeSp(fontSizeSp)
                            bind(currentController)
                            requestFocus()
                        }
```

- [ ] **Step 2: Pass `fitToScreen` into `GoblinTerminalView` update**

In the `AndroidView(update = { view -> ... })` block, add `view.setFitToScreen(fitToScreen)` between viewport width and font size:

```kotlin
                    update = { view ->
                        view.setHorizontalViewportWidthPx(horizontalViewportWidthPx)
                        view.setFitToScreen(fitToScreen)
                        view.setFontSizeSp(fontSizeSp)
                        view.bind(currentController)
                        view.requestFocus()
                    },
```

- [ ] **Step 3: Run terminal UI layout tests**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.GoblinTerminalViewLayoutTest"
```

Expected: PASS.

---

### Task 4: Final Verification

**Files:**
- Verify only; no code changes expected.

- [ ] **Step 1: Run focused terminal tests**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.*"
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 2: Run full Android verification**

Run from `android/`:

```bash
./gradlew ":app:testDebugUnitTest" ":app:assembleDebug"
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Inspect diff scope**

Run from repository root:

```bash
git diff --stat
```

Expected: code changes are limited to:

- `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/AndroidTerminalViewport.kt`
- `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt`
- `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalViewLayoutTest.kt`

Existing unrelated dirty files may still appear from earlier terminal work. Do not revert them.

---

## Self-Review Checklist

- Spec coverage: Task 1 and Task 2 cover fit-mode fill math without changing reported columns or compressing text. Task 3 wires the mode from Compose. Task 4 verifies focused and full Android behavior.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps.
- Type consistency: `terminalRenderScaleX(widthPx, gridColumns, measuredFontWidthPx, fitToScreen)` is introduced in Task 2 and used consistently by tests and rendering.
- Scope check: implementation is limited to the three files named in the spec.
