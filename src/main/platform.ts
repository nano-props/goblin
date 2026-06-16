// Shared, mockable "is this macOS?" check for main-process code.
//
// Pulled out of menu.ts so terminal.ts (and any future platform-branching
// module) can branch on it without each one owning a copy of the literal
// `process.platform === 'darwin'` check. Tests can override via
// `vi.spyOn(platform, 'isMacOS').mockReturnValue(...)` to simulate a
// different platform without touching the real process.platform.
export const platform = {
  isMacOS(): boolean {
    return process.platform === 'darwin'
  },
}
