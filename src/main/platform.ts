// Shared platform boundary for native-host behavior and tests.
export const platform = {
  isMacOS(): boolean {
    return process.platform === 'darwin'
  },
}
