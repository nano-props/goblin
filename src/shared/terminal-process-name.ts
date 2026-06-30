export function isShellProcessName(processName: string): boolean {
  const base = processName.replace(/^.*[\\/]/, '')
  return /^(?:ba|z|fi|tc|c|k)?sh$|^nu$/.test(base)
}
