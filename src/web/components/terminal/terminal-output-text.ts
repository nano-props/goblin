export function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\x1b(?:[@-Z\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
}
