# Android Terminal CJK Font Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Android terminal use a bundled CJK monospace font so Chinese and mixed Chinese/ASCII output no longer feels horizontally compressed.

**Architecture:** Add one Android `res/font` Regular CJK monospace TTF asset, expose it through a small terminal typeface provider with fallback to `Typeface.MONOSPACE`, then wire `GoblinTerminalView` so `TerminalRenderer` uses that same typeface for rendering and metric measurement. SSH transport, terminal emulator state, input routing, session ownership, reconnect, and foreground service code stay unchanged.

**Tech Stack:** Kotlin, Android API 26 font resources, Termux `TerminalRenderer`, JUnit, Gradle Android unit tests.

---

## Project Instruction Override

This repository's `AGENTS.md` says not to plan or execute git commits unless the user explicitly asks. This plan intentionally has no git commit steps. Use `git diff` inspection at task boundaries instead.

## Source And Format Notes

- Android font resources support `res/font/filename.ttf`, `.ttc`, `.otf`, or `.xml`; do not put the existing Web `.woff2` font into Android `res/font`.
- Maple Mono's GitHub README documents the CN version's Chinese/English 2:1 alignment and SIL Open Font License 1.1.
- The Maple Mono v7.9 GitHub release lists `MapleMono-CN-unhinted.zip` with SHA-256 `d41cb72721e99cfe4fbd1a7b0f182a013457de46aa612018f924dd024699d3b9`.
- Use `MapleMono-CN-Regular.ttf` rather than the NF-CN package for this phase. The terminal-specific visual goal is CJK monospace readability; Nerd Font icon coverage is outside this phase and would increase asset size.

## File Structure

- Create: `android/app/src/main/res/font/goblin_terminal_cjk_regular.ttf`
  - Bundled Regular CJK monospace terminal font loaded through `R.font.goblin_terminal_cjk_regular`.
- Create: `docs/android/terminal-font-asset.md`
  - Records font source, release, license, archive hash, chosen asset, local path, and size gate.
- Create: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalTypefaceProvider.kt`
  - Provides terminal typeface resolution and fallback in one small boundary.
- Create: `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalTypefaceProviderTest.kt`
  - Tests fallback behavior through a pure resolver seam.
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt`
  - Replaces direct `Typeface.MONOSPACE` renderer creation with the terminal typeface provider.

No other source files should change.

---

### Task 1: Add Font Asset And Provenance Document

**Files:**
- Create: `android/app/src/main/res/font/goblin_terminal_cjk_regular.ttf`
- Create: `docs/android/terminal-font-asset.md`

- [ ] **Step 1: Create the Android font resource directory**

Run from the repository root:

```bash
mkdir -p "android/app/src/main/res/font" "docs/android"
```

Expected result: both directories exist.

- [ ] **Step 2: Download the verified upstream font archive**

Run from the repository root. This requires network access:

```bash
curl --fail --location \
  --output "/private/tmp/MapleMono-CN-unhinted.zip" \
  "https://github.com/subframe7536/maple-font/releases/download/v7.9/MapleMono-CN-unhinted.zip"
```

Expected result: `/private/tmp/MapleMono-CN-unhinted.zip` exists and is non-empty.

- [ ] **Step 3: Verify the upstream archive hash**

Run:

```bash
printf "%s  %s\n" \
  "d41cb72721e99cfe4fbd1a7b0f182a013457de46aa612018f924dd024699d3b9" \
  "/private/tmp/MapleMono-CN-unhinted.zip" | shasum -a 256 -c -
```

Expected result:

```text
/private/tmp/MapleMono-CN-unhinted.zip: OK
```

- [ ] **Step 4: Extract the Regular TTF as the Android resource**

Run:

```bash
FONT_ENTRY="$(zipinfo -1 "/private/tmp/MapleMono-CN-unhinted.zip" | rg '(^|/)MapleMono-CN-Regular\.ttf$' | head -n 1)"
test -n "$FONT_ENTRY"
unzip -p "/private/tmp/MapleMono-CN-unhinted.zip" "$FONT_ENTRY" > "android/app/src/main/res/font/goblin_terminal_cjk_regular.ttf"
test -s "android/app/src/main/res/font/goblin_terminal_cjk_regular.ttf"
```

Expected result: command exits `0`, and `android/app/src/main/res/font/goblin_terminal_cjk_regular.ttf` exists.

- [ ] **Step 5: Run the asset format and size gate**

Run:

```bash
file "android/app/src/main/res/font/goblin_terminal_cjk_regular.ttf"
stat -f "%z" "android/app/src/main/res/font/goblin_terminal_cjk_regular.ttf"
test "$(stat -f "%z" "android/app/src/main/res/font/goblin_terminal_cjk_regular.ttf")" -le 41943040
```

Expected result:

- `file` reports a TrueType or OpenType font.
- `stat` prints a byte size.
- The final `test` exits `0`, proving the bundled Regular asset is at most `40 MiB`.

If the final `test` fails, stop before modifying production Kotlin code and choose a smaller Android-loadable CJK monospace font.

- [ ] **Step 6: Create the font provenance document**

Add this exact file at `docs/android/terminal-font-asset.md`:

```markdown
# Android Terminal Font Asset

## Selected Font

- Family: Maple Mono CN
- Style: Regular
- Local Android resource: `android/app/src/main/res/font/goblin_terminal_cjk_regular.ttf`
- Upstream project: https://github.com/subframe7536/maple-font
- Upstream release: `v7.9`
- Upstream archive: `MapleMono-CN-unhinted.zip`
- Archive URL: https://github.com/subframe7536/maple-font/releases/download/v7.9/MapleMono-CN-unhinted.zip
- Archive SHA-256: `d41cb72721e99cfe4fbd1a7b0f182a013457de46aa612018f924dd024699d3b9`
- License: SIL Open Font License 1.1

## Selection Rationale

Goblin Android terminal needs readable Chinese and mixed Chinese/ASCII terminal output. Maple Mono CN is selected because the upstream project documents Chinese/Japanese glyph support and Chinese/English 2:1 alignment, which matches the terminal readability direction selected during brainstorming.

The non-NF CN package is used for this phase because terminal CJK readability is the goal. Nerd Font icon coverage is outside this phase and would increase the Android asset footprint.

## Integration Constraints

- Use only the Regular face in this phase.
- Keep the local font resource at or below 40 MiB.
- Load the font through Android `Resources.getFont(...)`.
- Do not use Web `.woff2` assets in Android native rendering.
- Fall back to `Typeface.MONOSPACE` if Android rejects or cannot load the bundled resource.
```

- [ ] **Step 7: Inspect the asset diff**

Run:

```bash
git diff --stat -- "android/app/src/main/res/font/goblin_terminal_cjk_regular.ttf" "docs/android/terminal-font-asset.md"
git status --short -- "android/app/src/main/res/font/goblin_terminal_cjk_regular.ttf" "docs/android/terminal-font-asset.md"
```

Expected result: only the new font resource and provenance document appear for this task.

---

### Task 2: Add Terminal Typeface Provider

**Files:**
- Create: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalTypefaceProvider.kt`
- Create: `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalTypefaceProviderTest.kt`

- [ ] **Step 1: Write the failing provider tests**

Create `android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalTypefaceProviderTest.kt`:

```kotlin
package dev.goblin.android.ui.screens.terminals

import org.junit.Assert.assertEquals
import org.junit.Test

class TerminalTypefaceProviderTest {
    @Test
    fun `resource resolver returns bundled value when loading succeeds`() {
        assertEquals(
            "bundled",
            terminalResourceOrFallback(fallback = "fallback") { "bundled" },
        )
    }

    @Test
    fun `resource resolver falls back when loading throws`() {
        assertEquals(
            "fallback",
            terminalResourceOrFallback(fallback = "fallback") {
                throw IllegalArgumentException("missing terminal font")
            },
        )
    }

    @Test
    fun `resource resolver falls back when loading returns null`() {
        assertEquals(
            "fallback",
            terminalResourceOrFallback(fallback = "fallback") { null },
        )
    }
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from the repository root:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.TerminalTypefaceProviderTest"
```

Expected result: Kotlin test compilation fails because `terminalResourceOrFallback` does not exist.

- [ ] **Step 3: Add the provider implementation**

Create `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalTypefaceProvider.kt`:

```kotlin
package dev.goblin.android.ui.screens.terminals

import android.content.Context
import android.graphics.Typeface
import dev.goblin.android.R

internal fun <T : Any> terminalResourceOrFallback(
    fallback: T,
    loadResource: () -> T?,
): T = runCatching { loadResource() }.getOrNull() ?: fallback

internal object TerminalTypefaceProvider {
    @Volatile
    private var cachedTypeface: Typeface? = null

    fun terminalTypeface(context: Context): Typeface {
        val cached = cachedTypeface
        if (cached != null) return cached
        val resolved = terminalResourceOrFallback(fallback = Typeface.MONOSPACE) {
            context.resources.getFont(R.font.goblin_terminal_cjk_regular)
        }
        cachedTypeface = resolved
        return resolved
    }
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.TerminalTypefaceProviderTest"
```

Expected result: `TerminalTypefaceProviderTest` passes.

- [ ] **Step 5: Inspect the provider diff**

Run:

```bash
git diff -- "android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalTypefaceProvider.kt" "android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalTypefaceProviderTest.kt"
```

Expected result: the diff contains only the provider and the three resolver tests.

---

### Task 3: Wire The Typeface Into GoblinTerminalView

**Files:**
- Modify: `android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt`

- [ ] **Step 1: Replace direct system monospace renderer creation**

In `GoblinTerminalView.kt`, remove this import:

```kotlin
import android.graphics.Typeface
```

In the `GoblinTerminalView` class field block, replace:

```kotlin
private var currentFontSizeSp = TerminalDefaultFontSizeSp
private var renderer = TerminalRenderer(currentFontSizeSp.spToPx(), Typeface.MONOSPACE)
```

with:

```kotlin
private var currentFontSizeSp = TerminalDefaultFontSizeSp
private val terminalTypeface = TerminalTypefaceProvider.terminalTypeface(context)
private var renderer = TerminalRenderer(currentFontSizeSp.spToPx(), terminalTypeface)
```

In `setFontSizeSp`, replace:

```kotlin
renderer = TerminalRenderer(currentFontSizeSp.spToPx(), Typeface.MONOSPACE)
```

with:

```kotlin
renderer = TerminalRenderer(currentFontSizeSp.spToPx(), terminalTypeface)
```

- [ ] **Step 2: Run the source guard**

Run from the repository root:

```bash
rg -n "Typeface\\.MONOSPACE|import android\\.graphics\\.Typeface" "android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt"
```

Expected result: no matches, and `rg` exits `1`.

- [ ] **Step 3: Compile Android Kotlin**

Run:

```bash
cd "android"
./gradlew ":app:compileDebugKotlin"
```

Expected result: Kotlin compilation passes, proving `R.font.goblin_terminal_cjk_regular` resolves and `GoblinTerminalView` compiles with the provider.

- [ ] **Step 4: Run terminal tests**

Run:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.*"
```

Expected result: terminal UI unit tests pass, including `GoblinTerminalViewLayoutTest` and `TerminalTypefaceProviderTest`.

- [ ] **Step 5: Inspect the renderer wiring diff**

Run:

```bash
git diff -- "android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt"
```

Expected result:

- `GoblinTerminalView` no longer imports `android.graphics.Typeface`.
- Initial renderer creation uses `terminalTypeface`.
- Font-size changes recreate `TerminalRenderer` with the same `terminalTypeface`.
- No SSH, emulator, session, input, scrollback, or resize logic changed.

---

### Task 4: Verify Asset, Compile, And Scope Boundaries

**Files:**
- Verify: all files changed by Tasks 1-3

- [ ] **Step 1: Run the architecture guard from the repository root**

Run:

```bash
bun run check:architecture
```

Expected result: architecture check passes. This feature should not add imports across `src/main`, `src/web`, `src/server`, or `src/shared` boundaries.

- [ ] **Step 2: Run Android Kotlin compilation**

Run:

```bash
cd "android"
./gradlew ":app:compileDebugKotlin"
```

Expected result: Kotlin compilation passes.

- [ ] **Step 3: Run focused terminal tests**

Run:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" --tests "dev.goblin.android.ui.screens.terminals.*"
```

Expected result: terminal tests pass.

- [ ] **Step 4: Run provider and layout tests explicitly**

Run:

```bash
cd "android"
./gradlew ":app:testDebugUnitTest" \
  --tests "dev.goblin.android.ui.screens.terminals.TerminalTypefaceProviderTest" \
  --tests "dev.goblin.android.ui.screens.terminals.GoblinTerminalViewLayoutTest"
```

Expected result: both named test classes pass.

- [ ] **Step 5: Verify no out-of-scope Android terminal runtime files changed**

Run from the repository root:

```bash
git diff --name-only -- \
  "android/app/src/main/java/dev/goblin/android/terminals/SshTerminalService.kt" \
  "android/app/src/main/java/dev/goblin/android/terminals/TerminalController.kt" \
  "android/app/src/main/java/dev/goblin/android/terminals/TerminalSessionManager.kt" \
  "android/app/src/main/java/dev/goblin/android/terminals/emulator/RemoteTerminalEmulatorController.kt" \
  "android/app/src/main/java/dev/goblin/android/terminals/emulator/RemoteTerminalOutput.kt" \
  "android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalScreen.kt"
```

Expected result: output is either empty or limited to changes that were already present before this plan started. Do not revert user-owned pre-existing changes. This feature's own diff must not add new changes to SSH transport, emulator bridge, session manager, input routing, reconnect, foreground service, or `TerminalScreen` action logic.

- [ ] **Step 6: Inspect final scoped diff without committing**

Run:

```bash
git status --short
git diff --stat
git diff -- \
  "android/app/src/main/res/font/goblin_terminal_cjk_regular.ttf" \
  "docs/android/terminal-font-asset.md" \
  "android/app/src/main/java/dev/goblin/android/ui/screens/terminals/TerminalTypefaceProvider.kt" \
  "android/app/src/test/java/dev/goblin/android/ui/screens/terminals/TerminalTypefaceProviderTest.kt" \
  "android/app/src/main/java/dev/goblin/android/ui/screens/terminals/GoblinTerminalView.kt"
```

Expected result: final diff is limited to the font asset, provenance doc, provider, provider tests, and `GoblinTerminalView` renderer typeface wiring.

---

### Task 5: Manual Android Verification

**Files:**
- Verify: Android app runtime behavior

- [ ] **Step 1: Build the Android debug APK**

Run:

```bash
cd "android"
./gradlew ":app:assembleDebug"
```

Expected result: debug APK builds successfully.

- [ ] **Step 2: Install and open the app on an Android device or emulator**

Run:

```bash
adb install -r "android/app/build/outputs/apk/debug/app-debug.apk"
adb shell monkey -p "dev.goblin.android" 1
```

After opening the app, navigate to an SSH terminal session.

Expected result: the terminal screen opens without a crash.

- [ ] **Step 3: Verify mixed Chinese and ASCII terminal output**

Run these commands in the SSH terminal:

```bash
pwd
printf '中文 English 123 /home/dev/项目\n'
printf '路径: /home/dev/项目/goblin-android\n'
git status --short
```

Expected result:

- Chinese glyphs no longer look horizontally compressed.
- English, digits, and punctuation remain readable.
- Mixed Chinese/ASCII output keeps stable monospace alignment.
- Long paths wrap or scroll consistently with the current fit-to-screen/original-width behavior.

- [ ] **Step 4: Verify terminal behavior did not regress**

Exercise these existing terminal interactions:

```text
Font larger
Font smaller
Reset font size
Fit to screen width
Original width
Touch scrollback
Horizontal scroll
Paste
Reconnect terminal
Close terminal
```

Expected result: each interaction behaves as before, and terminal output remains readable after font-size changes.

- [ ] **Step 5: Record manual verification notes**

Append a dated note to `docs/android/terminal-font-asset.md`:

```markdown

## Manual Verification

- Date: 2026-06-07
- Device: default adb target selected by `adb devices`
- Commands checked:
  - `pwd`
  - `printf '中文 English 123 /home/dev/项目\n'`
  - `printf '路径: /home/dev/项目/goblin-android\n'`
  - `git status --short`
- Result: terminal CJK mixed output no longer appears horizontally compressed, and existing terminal controls still work.
```

Then inspect the doc diff:

```bash
git diff -- "docs/android/terminal-font-asset.md"
```

Expected result: the verification note is appended under `Manual Verification`.
